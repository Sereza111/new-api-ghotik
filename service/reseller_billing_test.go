/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"context"
	"errors"
	"math"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func seedTariffReseller(t *testing.T, info *relaycommon.RelayInfo, baseCost string) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.ResellerKey{
		TokenId: info.TokenId, UserId: info.UserId, BaseCostPerMillion: baseCost,
		TokenMillions: 1, Endpoint: "https://example.test/v1", CreatedTime: 1,
	}).Error)
	info.PriceData = types.PriceData{
		ModelRatio: 1, CompletionRatio: 1,
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
	}
}

func TestResellerPanelTariffSettlementMatchesWalletLog(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		var version string
		require.NoError(t, model.DB.Raw("SELECT sqlite_version()").Scan(&version).Error)
		t.Log(version)
		testResellerPanelTariffSettlement(t)
	})
	for _, dialect := range []common.DatabaseType{common.DatabaseTypeMySQL, common.DatabaseTypePostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			dsnName := "TEST_MYSQL_DSN"
			if dialect == common.DatabaseTypePostgreSQL {
				dsnName = "TEST_POSTGRES_DSN"
			}
			dsn := os.Getenv(dsnName)
			if dsn == "" {
				t.Skip(dsnName + " is not configured")
			}
			var driver gorm.Dialector = mysql.Open(dsn)
			if dialect == common.DatabaseTypePostgreSQL {
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			defer sqlDB.Close()
			oldDB, oldLogDB := model.DB, model.LOG_DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			model.DB, model.LOG_DB = db, db
			common.SetDatabaseTypes(dialect, dialect)
			defer func() {
				model.DB, model.LOG_DB = oldDB, oldLogDB
				common.SetDatabaseTypes(oldMain, oldLog)
			}()
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.ResellerKey{}, &model.ResellerQuotaOperation{}, &model.Channel{}, &model.Log{}))
			var version string
			require.NoError(t, db.Raw("SELECT VERSION()").Scan(&version).Error)
			t.Log(version)
			testResellerPanelTariffSettlement(t)
		})
	}
}

func testResellerPanelTariffSettlement(t *testing.T) {
	t.Helper()
	for _, tc := range []struct {
		name                                 string
		input, output, cached                int
		ratio, completion, cacheRatio, group float64
		wantPanel, wantPackage               int
	}{
		{"Astra reported uncached request", 71562, 572, 0, .1, 5, .1, 1, 7442, 297680},
		{"Astra cache is priced", 100000, 1000, 90000, .1, 5, .1, 1, 2400, 96000},
		{"Luna same usage cheaper", 100000, 1000, 90000, .01, 6, .1, 1, 250, 10000},
		{"source discount applies once", 100000, 1000, 90000, .1, 5, .1, .8, 1920, 76800},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Cleanup(func() {
				for _, table := range []string{"reseller_quota_operations", "reseller_keys", "tokens", "users", "channels", "logs"} {
					require.NoError(t, model.DB.Exec("DELETE FROM "+table).Error)
				}
			})
			seedUser(t, 501, 100000)
			seedToken(t, 502, 501, "rsl_tariff-test", 1000000)
			seedChannel(t, 503)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				TokenId: 502, TokenKey: "rsl_tariff-test", UserId: 501,
				OriginModelName: "tariff-test", RelayFormat: relaytypes.RelayFormatOpenAI,
				Request:   &dto.GeneralOpenAIRequest{MaxTokens: common.GetPointer(uint(tc.output))},
				StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 503},
			}
			seedTariffReseller(t, info, "0.05")
			info.PriceData = types.PriceData{ModelPrice: -1, ModelRatio: tc.ratio, CompletionRatio: tc.completion,
				CacheRatio: tc.cacheRatio, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: tc.group}}
			info.SetEstimatePromptTokens(tc.input)
			require.Nil(t, PreConsumeBilling(ctx, 1, info))
			assert.True(t, info.ResellerTariffBilling)
			assert.GreaterOrEqual(t, info.Billing.GetPreConsumedQuota(), tc.wantPackage)
			PostTextConsumeQuota(ctx, info, &dto.Usage{
				PromptTokens: tc.input, CompletionTokens: tc.output, TotalTokens: tc.input + tc.output,
				UsageSemantic:       dto.BillingUsageSemanticOpenAI,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: tc.cached},
			}, nil)
			require.NoError(t, info.Billing.Settle(tc.wantPackage), "settlement retry must not double-charge")
			info.Billing.Refund(ctx)
			var token model.Token
			require.NoError(t, model.DB.First(&token, 502).Error)
			assert.Equal(t, tc.wantPackage, token.UsedQuota)
			assert.Equal(t, 1000000-tc.wantPackage, token.RemainQuota)
			var log model.Log
			require.NoError(t, model.LOG_DB.Where("token_id = ?", 502).Last(&log).Error)
			assert.Equal(t, tc.wantPanel, log.Quota)
			var other map[string]interface{}
			require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
			assert.Equal(t, float64(tc.wantPackage), other["reseller_token_quota"])
			assert.Equal(t, "panel_tariff_v1", other["reseller_billing_basis"])
			var user model.User
			require.NoError(t, model.DB.First(&user, 501).Error)
			assert.Equal(t, 100000, user.Quota, "prepaid usage must not charge the owner's wallet again")
		})
	}
}

func TestResellerTariffConversionBoundaries(t *testing.T) {
	quota, clamp, err := resellerTariffTokenQuota(0, "0.05")
	require.NoError(t, err)
	assert.Nil(t, clamp)
	assert.Zero(t, quota)
	quota, clamp, err = resellerTariffTokenQuota(1, "3")
	require.NoError(t, err)
	assert.Nil(t, clamp)
	assert.Equal(t, 1, quota, "a fractional package charge is rounded up")
	for _, base := range []string{"", "0", "-1", "NaN"} {
		_, _, err = resellerTariffTokenQuota(1, base)
		require.Error(t, err)
	}
	_, _, err = resellerTariffTokenQuota(-1, "0.05")
	require.Error(t, err)
	_, clamp, err = resellerTariffTokenQuota(common.MaxQuota, "0.000001")
	require.NoError(t, err)
	require.NotNil(t, clamp)
}

func TestResellerTariffReservationUsesPanelBaseInputRate(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ResellerTariffBilling:      true,
		ResellerBaseCostPerMillion: "0.05",
		OriginModelName:            "gpt-6-astra",
		PriceData: types.PriceData{
			ModelRatio: .1, CompletionRatio: 5, CacheRatio: .1,
			CacheCreationRatio: 1.25,
			GroupRatioInfo:     types.GroupRatioInfo{GroupRatio: 1},
		},
	}

	// The reservation cannot know whether the input will be a cache read or a
	// cache write. The panel charges the reported category at settlement; the
	// pre-reservation therefore uses ordinary input plus the output ceiling,
	// instead of adding every cache category to the same input tokens.
	quota, clamp, err := resellerMaximumTariffQuota(info, 100_000, 1_000, 0)
	require.NoError(t, err)
	assert.Nil(t, clamp)
	assert.Equal(t, 420_000, quota)
}

func TestResellerTariffHardCapCoversRatesAndPaidTools(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		TokenKey: "rsl_tariff-bound", ResellerTariffBilling: true, ResellerBaseCostPerMillion: "0.05",
		RelayFormat: relaytypes.RelayFormatOpenAIResponses,
		Request:     &dto.OpenAIResponsesRequest{MaxOutputTokens: common.GetPointer(uint(1000))},
		PriceData: types.PriceData{ModelRatio: .1, CompletionRatio: 5, CacheRatio: .1,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
	}
	info.SetEstimatePromptTokens(1000)
	info.TokenQuotaPreConsumed = 2000 // raw input + output is not enough at this tariff
	body := []byte(`{"input":"hello","max_output_tokens":1000,"tools":[{"type":"function","name":"read_file"}]}`)
	require.ErrorIs(t, ValidateResellerOutboundHardCapWithContext(ctx, info, body), model.ErrResellerTokenQuotaInsufficient)
	info.TokenQuotaPreConsumed = 1000000
	require.NoError(t, ValidateResellerOutboundHardCapWithContext(ctx, info, body))
	require.ErrorContains(t, ValidateResellerOutboundHardCapWithContext(ctx, info,
		[]byte(`{"input":"hello","max_output_tokens":1000,"tools":[{"type":"web_search"}]}`)), "hosted tools")
	price := operation_setting.GetToolPriceForModel(dto.BuildInToolWebSearch, "")
	require.Positive(t, price)
	_, _, err := resellerToolTariffQuota(info, relaytypes.RelayFormatClaude,
		[]byte(`{"tools":[{"type":"web_search_20250305"}]}`))
	require.ErrorContains(t, err, "bounded call limit")
	toolQuota, toolClamp, err := resellerToolTariffQuota(info, relaytypes.RelayFormatClaude,
		[]byte(`{"tools":[{"type":"web_search_20250305","max_uses":1}]}`))
	require.NoError(t, err)
	assert.Nil(t, toolClamp)
	assert.Positive(t, toolQuota)
	info.PriceData.ModelRatio = math.NaN()
	require.ErrorContains(t, ValidateResellerOutboundHardCapWithContext(ctx, info, body), "invalid reseller tariff")
	info.PriceData.ModelRatio = .1
	info.TieredBillingSnapshot = &billingexpr.BillingSnapshot{ExprString: "p * 1"}
	require.ErrorContains(t, ValidateResellerOutboundHardCapWithContext(ctx, info, body), "verified maximum charge")
}

func TestResellerTextTokenQuotaCountsEachProtocolTokenOnce(t *testing.T) {
	tests := []struct {
		name     string
		usage    *dto.Usage
		fallback int
		expected int
	}{
		{
			name: "OpenAI cache reads are excluded from input",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticOpenAI,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 25, CacheWriteTokens: 10},
			},
			expected: 115,
		},
		{
			name: "OpenAI cache write overlap does not change the formula",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticOpenAI,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 80, CacheWriteTokens: 80},
			},
			expected: 60,
		},
		{
			name: "cache reads greater than input are clamped",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticOpenAI,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 150},
			},
			expected: 40,
		},
		{
			name: "normalized Anthropic input includes cache read and creation",
			usage: &dto.Usage{
				PromptTokens: 100, InputTokens: 135, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticAnthropic,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 25, CachedCreationTokens: 10},
			},
			expected: 150,
		},
		{
			name: "fallback Anthropic prompt is uncached input",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticAnthropic,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 25, CachedCreationTokens: 10},
			},
			expected: 150,
		},
		{
			name: "cache-only Anthropic usage does not double count aggregate input",
			usage: &dto.Usage{
				InputTokens: 160, CompletionTokens: 40, UsageSemantic: dto.BillingUsageSemanticAnthropic,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 80, CachedCreationTokens: 80},
			},
			expected: 120,
		},
		{
			name: "total-only usage still charges input",
			usage: &dto.Usage{
				TotalTokens: 123, CompletionTokens: 23,
				UsageSemantic: dto.BillingUsageSemanticOpenAI,
			},
			expected: 123,
		},
		{
			name: "missing usage fields use the local prompt estimate",
			usage: &dto.Usage{
				UsageSemantic: dto.BillingUsageSemanticOpenAI,
			},
			fallback: 77,
			expected: 77,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			quota, clamp := resellerTextTokenQuota(testCase.usage, testCase.fallback)
			assert.Equal(t, testCase.expected, quota)
			assert.Nil(t, clamp)
		})
	}
}

func TestResellerRealtimeTokenQuotaExcludesCachedInput(t *testing.T) {
	tests := []struct {
		name     string
		usage    *dto.RealtimeUsage
		expected int
	}{
		{
			name: "cached input is excluded",
			usage: &dto.RealtimeUsage{
				InputTokens: 100, OutputTokens: 50,
				InputTokenDetails: dto.InputTokenDetails{CachedTokens: 70},
			},
			expected: 80,
		},
		{
			name: "cache detail cannot make usage negative",
			usage: &dto.RealtimeUsage{
				InputTokens: 50, OutputTokens: 10,
				InputTokenDetails: dto.InputTokenDetails{CachedTokens: 80},
			},
			expected: 10,
		},
		{
			name:     "total-only realtime usage derives input",
			usage:    &dto.RealtimeUsage{TotalTokens: 90, OutputTokens: 20},
			expected: 90,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			quota, clamp := resellerRealtimeTokenQuota(testCase.usage)
			assert.Equal(t, testCase.expected, quota)
			assert.Nil(t, clamp)
		})
	}
}

func TestPreConsumeBillingUsesResellerTariffEstimate(t *testing.T) {
	truncate(t)
	seedUser(t, 51, 100_000)
	seedToken(t, 52, 51, "rsl_raw-estimate", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	maxTokens := uint(80)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 52, TokenKey: "rsl_raw-estimate", UserId: 51,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxTokens},
	}
	relayInfo.SetEstimatePromptTokens(120)
	relayInfo.SetEstimateCompletionTokens(80)
	seedTariffReseller(t, relayInfo, "2")

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.Nil(t, apiErr)
	require.NotNil(t, relayInfo.Billing)
	assert.Equal(t, 200, relayInfo.Billing.GetPreConsumedQuota(), "reseller generation reserves only prompt plus explicit output cap")
	require.NoError(t, relayInfo.Billing.Settle(180))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 52).Error)
	assert.Equal(t, 9_820, token.RemainQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 51).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestResellerFixedPriceImageBillingUsesPurchasedTokenEquivalent(t *testing.T) {
	tests := []struct {
		name          string
		monetaryQuota int
		wantTokens    int
	}{
		{name: "$0.01 image", monetaryQuota: 5_000, wantTokens: 200_000},
		{name: "$0.02 image", monetaryQuota: 10_000, wantTokens: 400_000},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			quota, clamp, err := resellerFixedPriceTokenQuota(testCase.monetaryQuota, "0.05")
			require.NoError(t, err)
			assert.Nil(t, clamp)
			assert.Equal(t, testCase.wantTokens, quota)
		})
	}

	truncate(t)
	seedUser(t, 251, 100_000)
	seedToken(t, 252, 251, "rsl_fixed-price-image", 1_000_000)
	seedChannel(t, 259)
	require.NoError(t, model.DB.Create(&model.ResellerKey{
		TokenId: 252, UserId: 251, TokenMillions: 1,
		MarkupPercent: 100, BaseCostPerMillion: "0.05",
		Endpoint: "https://pugshop.ru/v1", CreatedTime: 1,
	}).Error)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 252, TokenKey: "rsl_fixed-price-image", UserId: 251,
		OriginModelName: "gpt-image-2", RelayFormat: relaytypes.RelayFormatOpenAIImage,
		Request:     &dto.ImageRequest{Model: "gpt-image-2", Prompt: "test"},
		StartTime:   time.Now(),
		ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 259},
		PriceData: types.PriceData{
			UsePrice: true, ModelPrice: 0.02, QuotaToPreConsume: 10_000,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
	}

	require.Nil(t, PreConsumeBilling(ctx, 10_000, relayInfo))
	require.NotNil(t, relayInfo.Billing)
	assert.Equal(t, 400_000, relayInfo.Billing.GetPreConsumedQuota())
	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{PromptTokens: 1, TotalTokens: 1}, nil)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 252).Error)
	assert.Equal(t, 600_000, token.RemainQuota)
	assert.Equal(t, 400_000, token.UsedQuota)
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", 252).Last(&log).Error)
	var other map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, float64(400_000), other["reseller_token_quota"])
	assert.Equal(t, float64(400_000), other["reseller_measured_tokens"])

	seedToken(t, 254, 251, "rsl_fixed-price-image-low-balance", 100_000)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 254).Update("used_quota", 900_000).Error)
	require.NoError(t, model.DB.Create(&model.ResellerKey{
		TokenId: 254, UserId: 251, TokenMillions: 1,
		MarkupPercent: 100, BaseCostPerMillion: "0.05",
		Endpoint: "https://pugshop.ru/v1", CreatedTime: 1,
	}).Error)
	insufficientInfo := &relaycommon.RelayInfo{
		TokenId: 254, TokenKey: "rsl_fixed-price-image-low-balance", UserId: 251,
		OriginModelName: "gpt-image-2", RelayFormat: relaytypes.RelayFormatOpenAIImage,
		Request: &dto.ImageRequest{Model: "gpt-image-2", Prompt: "test"},
		PriceData: types.PriceData{
			UsePrice: true, ModelPrice: 0.02, QuotaToPreConsume: 10_000,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
		},
	}
	apiErr := PreConsumeBilling(ctx, 10_000, insufficientInfo)
	require.NotNil(t, apiErr)
	assert.Equal(t, 403, apiErr.StatusCode)
	assert.Nil(t, insufficientInfo.Billing)
	token = model.Token{}
	require.NoError(t, model.DB.First(&token, 254).Error)
	assert.Equal(t, 100_000, token.RemainQuota)
	assert.Equal(t, 900_000, token.UsedQuota)
}

func TestResellerInitialReservationIsIdempotent(t *testing.T) {
	truncate(t)
	seedUser(t, 57, 100_000)
	seedToken(t, 58, 57, "rsl_idempotent-reserve", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	maxTokens := uint(100)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 58, TokenKey: "rsl_idempotent-reserve", UserId: 57,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxTokens},
	}
	relayInfo.SetEstimatePromptTokens(100)
	seedTariffReseller(t, relayInfo, "2")

	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))
	session, ok := relayInfo.Billing.(*BillingSession)
	require.True(t, ok)
	require.NoError(t, session.reserveToken(200, 200, "reserve_initial", false), "an ambiguous reserve retry must reuse its operation marker")

	var token model.Token
	require.NoError(t, model.DB.First(&token, 58).Error)
	assert.Equal(t, 9_800, token.RemainQuota)
	assert.Equal(t, 200, token.UsedQuota)
	var operations []model.ResellerQuotaOperation
	require.NoError(t, model.DB.Where("token_id = ?", 58).Find(&operations).Error)
	require.Len(t, operations, 1)
	assert.Equal(t, -200, operations[0].Adjustment)
}

func TestResellerReservationExtensionsWithEqualDeltasAreDistinct(t *testing.T) {
	truncate(t)
	seedUser(t, 59, 100_000)
	seedToken(t, 60, 59, "rsl_equal-extensions", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	maxTokens := uint(100)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 60, TokenKey: "rsl_equal-extensions", UserId: 59,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxTokens},
	}
	relayInfo.SetEstimatePromptTokens(100)
	seedTariffReseller(t, relayInfo, "2")

	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))
	require.NoError(t, relayInfo.Billing.Reserve(300))
	require.NoError(t, relayInfo.Billing.Reserve(400))
	require.NoError(t, relayInfo.Billing.Reserve(400), "retrying the same target must be a no-op")

	var token model.Token
	require.NoError(t, model.DB.First(&token, 60).Error)
	assert.Equal(t, 9_600, token.RemainQuota)
	assert.Equal(t, 400, token.UsedQuota)
	var operations []model.ResellerQuotaOperation
	require.NoError(t, model.DB.Where("token_id = ?", 60).Find(&operations).Error)
	require.Len(t, operations, 3)
}

func TestResellerReserveRejectsRefundInProgress(t *testing.T) {
	truncate(t)
	seedUser(t, 65, 100_000)
	seedToken(t, 66, 65, "rsl_refund-race", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	maxTokens := uint(100)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 66, TokenKey: "rsl_refund-race", UserId: 65,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxTokens},
	}
	relayInfo.SetEstimatePromptTokens(100)
	seedTariffReseller(t, relayInfo, "2")
	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))
	session := relayInfo.Billing.(*BillingSession)
	session.refundInFlight = true

	require.ErrorContains(t, session.Reserve(300), "refund has started")
	var token model.Token
	require.NoError(t, model.DB.First(&token, 66).Error)
	assert.Equal(t, 9_800, token.RemainQuota)
}

func TestResellerRefundReconcilesAmbiguousReservationCommit(t *testing.T) {
	truncate(t)
	seedUser(t, 67, 100_000)
	seedToken(t, 68, 67, "rsl_ambiguous-extension", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	maxTokens := uint(100)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 68, TokenKey: "rsl_ambiguous-extension", UserId: 67,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxTokens},
	}
	relayInfo.SetEstimatePromptTokens(100)
	seedTariffReseller(t, relayInfo, "2")
	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))
	session := relayInfo.Billing.(*BillingSession)
	phase := "reserve_target_300"
	require.NoError(t, model.ApplyResellerTokenQuotaAdjustment(
		68,
		"rsl_ambiguous-extension",
		-100,
		session.tokenOperationID(phase),
	))
	session.pendingToken = &pendingTokenReservation{
		delta:       100,
		targetQuota: 300,
		phase:       phase,
		isExtension: true,
	}

	session.Refund(ctx)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 68).Error)
	assert.Equal(t, 10_000, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
	assert.True(t, session.refunded)
	assert.Nil(t, session.pendingToken)
	require.ErrorContains(t, session.Settle(100), "refund has started")
	require.ErrorContains(t, session.Reserve(400), "refund has started")
	require.NoError(t, model.DB.First(&token, 68).Error)
	assert.Equal(t, 10_000, token.RemainQuota)
}

func TestPreConsumeBillingRejectsResellerWithoutOutputLimit(t *testing.T) {
	truncate(t)
	seedUser(t, 91, 100_000)
	seedToken(t, 92, 91, "rsl_unbounded-generation", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", 10_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 92, TokenKey: "rsl_unbounded-generation", UserId: 91,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{},
	}
	relayInfo.SetEstimatePromptTokens(120)
	seedTariffReseller(t, relayInfo, "2")

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	assert.ErrorIs(t, apiErr, errResellerOutputTokenLimitRequired)
	assert.Nil(t, relayInfo.Billing)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 92).Error)
	assert.Equal(t, 10_000, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
}

func TestPreConsumeBillingRejectsExhaustedResellerBeforeRelay(t *testing.T) {
	truncate(t)
	seedUser(t, 93, 100_000)
	seedToken(t, 94, 93, "rsl_exhausted-generation", 0)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", 10_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 94, TokenKey: "rsl_exhausted-generation", UserId: 93,
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.GeneralOpenAIRequest{},
	}
	relayInfo.SetEstimatePromptTokens(120)
	seedTariffReseller(t, relayInfo, "2")

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.NotNil(t, apiErr)
	assert.ErrorIs(t, apiErr, model.ErrResellerTokenQuotaInsufficient)
	assert.Nil(t, relayInfo.Billing)
}

func TestResellerSettlementDisablesKeyWhenMeasuredUsageExceedsAllocation(t *testing.T) {
	truncate(t)
	seedUser(t, 99, 100_000)
	seedToken(t, 100, 99, "rsl_full-balance-cap", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 100, TokenKey: "rsl_full-balance-cap", UserId: 99,
		RelayFormat: relaytypes.RelayFormatOpenAIResponses,
		Request:     &dto.OpenAIResponsesRequest{MaxOutputTokens: common.GetPointer(uint(100))},
	}
	relayInfo.SetEstimatePromptTokens(1)
	seedTariffReseller(t, relayInfo, "2")
	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))

	assert.Equal(t, 101, relayInfo.Billing.GetPreConsumedQuota())
	require.NoError(t, relayInfo.Billing.Settle(15_000))
	require.NoError(t, relayInfo.Billing.Settle(15_000), "retry must not charge twice")
	var token model.Token
	require.NoError(t, model.DB.First(&token, 100).Error)
	assert.Zero(t, token.RemainQuota)
	assert.Equal(t, 10_000, token.UsedQuota)
	assert.Equal(t, common.TokenStatusDisabled, token.Status)
	require.NotNil(t, relayInfo.TokenQuotaCharged)
	assert.Equal(t, 10_000, *relayInfo.TokenQuotaCharged)
	assert.Equal(t, 5_000, relayInfo.TokenQuotaUnfunded)
	relayInfo.Billing.Refund(ctx)
	require.NoError(t, model.DB.First(&token, 100).Error)
	assert.Zero(t, token.RemainQuota, "a delivered response must keep its charge")
	assert.Equal(t, 10_000, token.UsedQuota)
}

type failingResellerBillingSettler struct {
	refunded bool
}

func (s *failingResellerBillingSettler) Settle(int) error         { return errors.New("settlement failed") }
func (s *failingResellerBillingSettler) Refund(*gin.Context)      { s.refunded = true }
func (s *failingResellerBillingSettler) NeedsRefund() bool        { return true }
func (s *failingResellerBillingSettler) GetPreConsumedQuota() int { return 100 }
func (s *failingResellerBillingSettler) Reserve(int) error        { return nil }

func TestSettleBillingDoesNotRefundDeliveredResellerResponse(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	settler := &failingResellerBillingSettler{}
	relayInfo := &relaycommon.RelayInfo{
		TokenKey: "rsl_delivered-response",
		Billing:  settler,
	}

	require.Error(t, SettleBilling(ctx, relayInfo, 50))
	assert.False(t, settler.refunded)
}

func TestPreConsumeBillingRejectsZeroOutputLimit(t *testing.T) {
	truncate(t)
	seedUser(t, 97, 100_000)
	seedToken(t, 98, 97, "rsl_zero-output-limit", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", 10_000)
	zero := uint(0)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 98, TokenKey: "rsl_zero-output-limit", UserId: 97,
		RelayFormat: relaytypes.RelayFormatClaude,
		RelayMode:   relayconstant.RelayModeChatCompletions,
		Request:     &dto.ClaudeRequest{MaxTokens: &zero},
	}
	relayInfo.SetEstimatePromptTokens(100)
	seedTariffReseller(t, relayInfo, "2")

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	assert.ErrorIs(t, apiErr, errResellerOutputTokenLimitRequired)
	assert.Nil(t, relayInfo.Billing)
}

func TestPreConsumeBillingReservesEstimatedInputOnlyUsage(t *testing.T) {
	tests := []struct {
		name      string
		relayInfo *relaycommon.RelayInfo
		tokenKey  string
		tokenID   int
		userID    int
	}{
		{
			name: "embeddings reserve the estimated input",
			relayInfo: &relaycommon.RelayInfo{
				RelayFormat: relaytypes.RelayFormatEmbedding,
				Request:     &dto.EmbeddingRequest{Input: "embedding input"},
			},
			tokenKey: "rsl_embedding-floor", tokenID: 96, userID: 95,
		},
		{
			name: "reranking reserves the estimated input",
			relayInfo: &relaycommon.RelayInfo{
				RelayFormat: relaytypes.RelayFormatRerank,
				Request:     &dto.RerankRequest{Documents: []any{"document"}, Query: "query"},
			},
			tokenKey: "rsl_rerank-floor", tokenID: 98, userID: 97,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			truncate(t)
			seedUser(t, testCase.userID, 100_000)
			seedToken(t, testCase.tokenID, testCase.userID, testCase.tokenKey, 10_000)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Set("token_quota", 10_000)
			testCase.relayInfo.TokenId = testCase.tokenID
			testCase.relayInfo.TokenKey = testCase.tokenKey
			testCase.relayInfo.UserId = testCase.userID
			testCase.relayInfo.SetEstimatePromptTokens(100)
			seedTariffReseller(t, testCase.relayInfo, "2")

			apiErr := PreConsumeBilling(ctx, 9_000, testCase.relayInfo)
			require.Nil(t, apiErr)
			require.NotNil(t, testCase.relayInfo.Billing)
			assert.Equal(t, 100, testCase.relayInfo.Billing.GetPreConsumedQuota())

			var stored model.Token
			require.NoError(t, model.DB.First(&stored, testCase.tokenID).Error)
			assert.Equal(t, 9_900, stored.RemainQuota)
		})
	}
}

func TestPostTextConsumeQuotaSettlesMeasuredResellerTokensAndLogsDurableDebit(t *testing.T) {
	truncate(t)
	seedUser(t, 53, 100_000)
	seedToken(t, 54, 53, "rsl_raw-text", 10_000)
	seedChannel(t, 59)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 54, TokenKey: "rsl_raw-text", UserId: 53, OriginModelName: "priced-model",
		StartTime:   time.Now(),
		ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 59},
		PriceData: types.PriceData{
			ModelRatio: 10, CompletionRatio: 5, CacheRatio: 0.1,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 2},
		},
	}
	session, apiErr := NewBillingSession(ctx, relayInfo, 20)
	require.Nil(t, apiErr)
	relayInfo.Billing = session

	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{
		PromptTokens: 100, CompletionTokens: 40, TotalTokens: 140,
		UsageSemantic:       dto.BillingUsageSemanticOpenAI,
		PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 25},
	}, nil)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 54).Error)
	assert.Equal(t, 9_885, token.RemainQuota)
	assert.Equal(t, 115, token.UsedQuota)
	var log model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", 54).Last(&log).Error)
	var other map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	assert.Equal(t, float64(token.UsedQuota), other["reseller_token_quota"])
	assert.Equal(t, float64(115), other["reseller_measured_tokens"])
	assert.NotContains(t, other, "reseller_usage_missing")
	var user model.User
	require.NoError(t, model.DB.First(&user, 53).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestPostTextConsumeQuotaRequiresAuthoritativeRawTokenUsage(t *testing.T) {
	tests := []struct {
		name           string
		usage          *dto.Usage
		locallyCounted bool
		wantRemaining  int
		wantUsed       int
	}{
		{
			name: "locally counted usage keeps the complete reservation",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, TotalTokens: 140,
				UsageSemantic: dto.BillingUsageSemanticOpenAI,
			},
			locallyCounted: true,
			wantRemaining:  0,
			wantUsed:       1_000,
		},
		{
			name: "estimated billing usage keeps the complete reservation",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 40, TotalTokens: 140,
				BillingUsage: dto.NewEstimatedGeminiChatBillingUsage(&dto.Usage{
					PromptTokens: 100, CompletionTokens: 40, TotalTokens: 140,
				}),
			},
			wantRemaining: 0,
			wantUsed:      1_000,
		},
		{
			name:          "missing usage keeps the complete reservation",
			usage:         nil,
			wantRemaining: 0,
			wantUsed:      1_000,
		},
		{
			name: "explicit upstream zero releases the reservation",
			usage: &dto.Usage{BillingUsage: &dto.BillingUsage{
				Source:      dto.BillingUsageSourceOAIChat,
				Semantic:    dto.BillingUsageSemanticOpenAI,
				OpenAIUsage: &dto.Usage{},
			}},
			wantRemaining: 1_000,
			wantUsed:      0,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			truncate(t)
			seedUser(t, 153, 100_000)
			seedToken(t, 154, 153, "rsl_raw-authority", 1_000)
			seedChannel(t, 159)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			if testCase.locallyCounted {
				common.SetContextKey(ctx, constant.ContextKeyLocalCountTokens, true)
			}
			relayInfo := &relaycommon.RelayInfo{
				TokenId: 154, TokenKey: "rsl_raw-authority", UserId: 153, OriginModelName: "priced-model",
				RelayFormat: relaytypes.RelayFormatEmbedding,
				Request:     &dto.EmbeddingRequest{Input: "input"},
				StartTime:   time.Now(),
				ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 159},
				PriceData: types.PriceData{
					ModelRatio: 1, CompletionRatio: 1,
					GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
				},
			}
			relayInfo.SetEstimatePromptTokens(1_000)
			seedTariffReseller(t, relayInfo, "2")
			require.Nil(t, PreConsumeBilling(ctx, 20, relayInfo))

			PostTextConsumeQuota(ctx, relayInfo, testCase.usage, nil)

			var token model.Token
			require.NoError(t, model.DB.First(&token, 154).Error)
			assert.Equal(t, testCase.wantRemaining, token.RemainQuota)
			assert.Equal(t, testCase.wantUsed, token.UsedQuota)
			var log model.Log
			require.NoError(t, model.LOG_DB.Where("token_id = ?", 154).Last(&log).Error)
			var other map[string]interface{}
			require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
			assert.Equal(t, float64(token.UsedQuota), other["reseller_token_quota"])
			if testCase.wantUsed == 1_000 {
				assert.Equal(t, true, other["reseller_usage_missing"])
				assert.NotContains(t, other, "reseller_measured_tokens")
			} else {
				assert.Equal(t, float64(0), other["reseller_measured_tokens"])
			}
		})
	}
}

func TestRealtimeResellerRequestsAreRejectedWithoutAggregateOutputCap(t *testing.T) {
	truncate(t)
	seedUser(t, 55, 100_000)
	seedToken(t, 56, 55, "rsl_raw-realtime", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", 10_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 56, TokenKey: "rsl_raw-realtime", UserId: 55,
		RelayFormat: relaytypes.RelayFormatOpenAIRealtime,
	}
	seedTariffReseller(t, relayInfo, "2")
	apiErr := PreConsumeBilling(ctx, 10, relayInfo)
	require.NotNil(t, apiErr)
	assert.Equal(t, 400, apiErr.StatusCode)
	assert.ErrorIs(t, apiErr, errResellerRequestHardCapUnsupported)
	assert.Nil(t, relayInfo.Billing)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 56).Error)
	assert.Equal(t, 10_000, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 55).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestLegacyResellerTaskSettlesRawReportedTokens(t *testing.T) {
	truncate(t)
	seedUser(t, 57, 100_000)
	seedToken(t, 58, 57, "rsl_raw-task", 600)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 58).Update("used_quota", 400).Error)
	task := makeTask(57, 0, 400, 58, BillingSourceReseller, 0)
	require.NoError(t, task.Insert())

	assert.True(t, RecalculateTaskQuotaByTokens(context.Background(), task, 100))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 58).Error)
	assert.Equal(t, 900, token.RemainQuota)
	assert.Equal(t, 100, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 57).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestResellerBillingConsumesMeasuredPrepaidTokenQuota(t *testing.T) {
	truncate(t)
	seedUser(t, 61, 1_000)
	seedToken(t, 62, 61, "rsl_prepaid-test-key", 100)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		TokenId:  62,
		TokenKey: "rsl_prepaid-test-key",
		UserId:   61,
	}

	session, apiErr := NewBillingSession(context, relayInfo, 20)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, BillingSourceReseller, relayInfo.BillingSource)
	require.NoError(t, session.Settle(30))

	var user model.User
	require.NoError(t, model.DB.First(&user, 61).Error)
	assert.Equal(t, 1_000, user.Quota)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 62).Error)
	assert.Equal(t, 70, token.RemainQuota)
	assert.Equal(t, 30, token.UsedQuota)
}

func TestResellerSettlementCanRetryTokenAdjustmentFailure(t *testing.T) {
	truncate(t)
	seedUser(t, 63, 1_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 64, TokenKey: "rsl_retry-settlement", UserId: 63,
	}
	session := &BillingSession{
		relayInfo: relayInfo, funding: &PrepaidTokenFunding{},
		preConsumedQuota: 100, tokenConsumed: 100,
	}

	require.Error(t, session.Settle(50))
	assert.False(t, session.settled)
	assert.False(t, session.fundingSettled, "reseller token failure must remain retryable")
	seedToken(t, 64, 63, "rsl_retry-settlement", 0)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 64).Update("used_quota", 100).Error)

	require.NoError(t, session.Settle(50))
	assert.True(t, session.settled)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 64).Error)
	assert.Equal(t, 50, token.RemainQuota)
	assert.Equal(t, 50, token.UsedQuota)
}

func TestResellerSettlementFailureCannotRefundDeliveredUsage(t *testing.T) {
	truncate(t)
	seedUser(t, 64, 1_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 65, TokenKey: "rsl_retry-refund", UserId: 64,
	}
	session := &BillingSession{
		relayInfo: relayInfo, funding: &PrepaidTokenFunding{},
		preConsumedQuota: 100, tokenConsumed: 100,
	}

	// A database failure after upstream delivery must not turn the response
	// into a free request. Preserve its hold and retry the same settlement.
	require.Error(t, session.Settle(50))
	assert.False(t, session.NeedsRefund())

	seedToken(t, 65, 64, "rsl_retry-refund", 0)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 65).Update("used_quota", 100).Error)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	session.Refund(ctx)
	assert.False(t, session.NeedsRefund())
	var token model.Token
	require.NoError(t, model.DB.First(&token, 65).Error)
	assert.Zero(t, token.RemainQuota)
	assert.Equal(t, 100, token.UsedQuota)
	require.ErrorContains(t, session.Settle(40), "settlement target changed")
	require.Error(t, session.Reserve(120))
	require.NoError(t, session.Settle(50))
	require.NoError(t, session.Settle(50))
	require.NoError(t, model.DB.First(&token, 65).Error)
	assert.Equal(t, 50, token.RemainQuota)
	assert.Equal(t, 50, token.UsedQuota)
}

func TestLegacyResellerBillingDoesNotMutateWallet(t *testing.T) {
	truncate(t)
	seedUser(t, 71, 1_000)
	seedToken(t, 72, 71, "rsl20_legacy-test-key", 100)
	relayInfo := &relaycommon.RelayInfo{
		TokenId:  72,
		TokenKey: "rsl20_legacy-test-key",
		UserId:   71,
	}

	require.NoError(t, PostConsumeQuota(relayInfo, 25, 0, false))

	var user model.User
	require.NoError(t, model.DB.First(&user, 71).Error)
	assert.Equal(t, 1_000, user.Quota)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 72).Error)
	assert.Equal(t, 75, token.RemainQuota)
	assert.Equal(t, 25, token.UsedQuota)
}

func TestAsyncResellerFundingAdjustmentIsNoOp(t *testing.T) {
	truncate(t)
	seedUser(t, 81, 1_000)
	task := makeTask(81, 0, 100, 0, BillingSourceReseller, 0)

	require.NoError(t, taskAdjustFunding(task, 400))
	require.NoError(t, taskAdjustFunding(task, -300))

	var user model.User
	require.NoError(t, model.DB.First(&user, 81).Error)
	assert.Equal(t, 1_000, user.Quota)
}

func TestLegacyMidjourneyRejectsResellerFunding(t *testing.T) {
	task := &model.Midjourney{}
	prepared, err := PrepareMidjourneyTaskBilling(
		&relaycommon.RelayInfo{TokenKey: "rsl100_legacy-midjourney"},
		task,
		100,
		true,
	)

	assert.False(t, prepared)
	assert.ErrorContains(t, err, "prepaid reseller keys")
}
