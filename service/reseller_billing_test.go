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
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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

func TestPreConsumeBillingUsesRawResellerEstimate(t *testing.T) {
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

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.Nil(t, apiErr)
	require.NotNil(t, relayInfo.Billing)
	assert.Equal(t, 10_000, relayInfo.Billing.GetPreConsumedQuota(), "generation reservations hold the full prepaid balance")
	require.NoError(t, relayInfo.Billing.Settle(580))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 52).Error)
	assert.Equal(t, 9_420, token.RemainQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 51).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestPreConsumeBillingReservesFullResellerBalanceWithoutOutputLimit(t *testing.T) {
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

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.Nil(t, apiErr)
	require.NotNil(t, relayInfo.Billing)
	assert.Equal(t, 10_000, relayInfo.Billing.GetPreConsumedQuota())

	var token model.Token
	require.NoError(t, model.DB.First(&token, 92).Error)
	assert.Zero(t, token.RemainQuota)
	require.NoError(t, relayInfo.Billing.Settle(150))
	require.NoError(t, model.DB.First(&token, 92).Error)
	assert.Equal(t, 9_850, token.RemainQuota)
	assert.Equal(t, 150, token.UsedQuota)
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

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.NotNil(t, apiErr)
	assert.ErrorIs(t, apiErr, model.ErrResellerTokenQuotaInsufficient)
	assert.Nil(t, relayInfo.Billing)
}

func TestFullBalanceSettlementCannotOverdrawResellerAllocation(t *testing.T) {
	truncate(t)
	seedUser(t, 99, 100_000)
	seedToken(t, 100, 99, "rsl_full-balance-cap", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 100, TokenKey: "rsl_full-balance-cap", UserId: 99,
		RelayFormat: relaytypes.RelayFormatOpenAIResponses,
		Request:     &dto.OpenAIResponsesRequest{},
	}
	relayInfo.SetEstimatePromptTokens(1)
	require.Nil(t, PreConsumeBilling(ctx, 1, relayInfo))

	require.NoError(t, relayInfo.Billing.Settle(15_000))
	var token model.Token
	require.NoError(t, model.DB.First(&token, 100).Error)
	assert.Zero(t, token.RemainQuota)
	assert.Equal(t, 10_000, token.UsedQuota)
}

func TestPreConsumeBillingTreatsZeroOutputLimitAsUnbounded(t *testing.T) {
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

	apiErr := PreConsumeBilling(ctx, 9_000, relayInfo)
	require.Nil(t, apiErr)
	assert.Equal(t, 10_000, relayInfo.Billing.GetPreConsumedQuota())
}

func TestPreConsumeBillingReservesFullBalanceForInputOnlyUsage(t *testing.T) {
	tests := []struct {
		name      string
		relayInfo *relaycommon.RelayInfo
		tokenKey  string
		tokenID   int
		userID    int
	}{
		{
			name: "embeddings remain capped when token estimation is unavailable",
			relayInfo: &relaycommon.RelayInfo{
				RelayFormat: relaytypes.RelayFormatEmbedding,
				Request:     &dto.GeneralOpenAIRequest{},
			},
			tokenKey: "rsl_embedding-floor", tokenID: 96, userID: 95,
		},
		{
			name: "reranking remains capped when token estimation is unavailable",
			relayInfo: &relaycommon.RelayInfo{
				RelayFormat: relaytypes.RelayFormatRerank,
				Request:     &dto.GeneralOpenAIRequest{},
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

			apiErr := PreConsumeBilling(ctx, 9_000, testCase.relayInfo)
			require.Nil(t, apiErr)
			require.NotNil(t, testCase.relayInfo.Billing)
			assert.Equal(t, 10_000, testCase.relayInfo.Billing.GetPreConsumedQuota())

			var stored model.Token
			require.NoError(t, model.DB.First(&stored, testCase.tokenID).Error)
			assert.Zero(t, stored.RemainQuota)
		})
	}
}

func TestPostTextConsumeQuotaSettlesRawResellerTokens(t *testing.T) {
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
	var user model.User
	require.NoError(t, model.DB.First(&user, 53).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestRealtimeResellerReserveAndSettlementAreRawAndWalletFree(t *testing.T) {
	truncate(t)
	seedUser(t, 55, 100_000)
	seedToken(t, 56, 55, "rsl_raw-realtime", 10_000)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", 10_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 56, TokenKey: "rsl_raw-realtime", UserId: 55,
		RelayFormat: relaytypes.RelayFormatOpenAIRealtime,
	}
	apiErr := PreConsumeBilling(ctx, 10, relayInfo)
	require.Nil(t, apiErr)
	assert.Equal(t, 10_000, relayInfo.Billing.GetPreConsumedQuota())
	usage := &dto.RealtimeUsage{
		TotalTokens: 150, InputTokens: 100, OutputTokens: 50,
		InputTokenDetails: dto.InputTokenDetails{CachedTokens: 70},
	}

	require.NoError(t, PreWssConsumeQuota(ctx, relayInfo, usage))
	assert.Equal(t, 10_000, relayInfo.Billing.GetPreConsumedQuota(), "usage consumes the balance already held at handshake")
	require.NoError(t, relayInfo.Billing.Settle(80))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 56).Error)
	assert.Equal(t, 9_920, token.RemainQuota)
	assert.Equal(t, 80, token.UsedQuota)
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

func TestResellerBillingConsumesOnlyPrepaidTokenQuota(t *testing.T) {
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
	assert.False(t, session.fundingSettled, "reseller token failure must remain refundable")
	seedToken(t, 64, 63, "rsl_retry-settlement", 0)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 64).Update("used_quota", 100).Error)

	require.NoError(t, session.Settle(50))
	assert.True(t, session.settled)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 64).Error)
	assert.Equal(t, 50, token.RemainQuota)
	assert.Equal(t, 50, token.UsedQuota)
}

func TestResellerRefundRemainsRetryableAfterSettlementFailure(t *testing.T) {
	truncate(t)
	seedUser(t, 64, 1_000)
	relayInfo := &relaycommon.RelayInfo{
		TokenId: 65, TokenKey: "rsl_retry-refund", UserId: 64,
	}
	session := &BillingSession{
		relayInfo: relayInfo, funding: &PrepaidTokenFunding{},
		preConsumedQuota: 100, tokenConsumed: 100,
	}

	// The first settlement cannot find its token.  It must not mark the
	// session settled/funding-settled, otherwise a failed request would lose
	// the entire prepaid reservation.
	require.Error(t, session.Settle(50))
	assert.True(t, session.NeedsRefund())

	seedToken(t, 65, 64, "rsl_retry-refund", 0)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 65).Update("used_quota", 100).Error)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	session.Refund(ctx)
	assert.False(t, session.NeedsRefund())
	var token model.Token
	require.NoError(t, model.DB.First(&token, 65).Error)
	assert.Equal(t, 100, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
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
