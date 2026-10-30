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
package controller

import (
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupResellerControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Ability{}))
	require.NoError(t, db.Create(&model.Ability{
		Group:     "default",
		Model:     "gpt-reseller-test",
		ChannelId: 1,
		Enabled:   true,
	}).Error)
	return db
}

func configureResellerGroupEligibilityTest(t *testing.T) {
	t.Helper()
	previousGroups := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default route","empty":"Empty route"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"empty":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
	})
}

func TestAddResellerKeyCreatesUsableToken(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id:       7,
		Username: "reseller-owner",
		Status:   common.UserStatusEnabled,
		Quota:    10_000_000,
	}).Error)
	seedActiveResellerSubscription(t, db, 7)
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label":   "Acme Studio",
		"token_millions": 50,
		"markup_percent": 80,
		"term":           "30-days",
		"endpoint":       "https://pugshop.ru/v1",
		"request_id":     "controller-create-1",
		"group":          "default",
	}, 7)
	ctx.Set("group", "default")

	AddResellerKey(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var created resellerKeyResponse
	require.NoError(t, common.Unmarshal(response.Data, &created))
	assert.Equal(t, "Acme Studio", created.ClientLabel)
	assert.Equal(t, 50, created.TokenMillions)
	assert.Equal(t, 50_000_000, created.RemainingTokens)
	assert.Equal(t, 80, created.MarkupPercent)
	assert.Equal(t, "30-days", created.Term)
	assert.Equal(t, 6.0, created.Cost)
	assert.Equal(t, 10.8, created.ClientPrice)
	assert.Equal(t, 0.12, created.BaseCostPerMillion)
	assert.True(t, strings.HasPrefix(created.Key, "sk-rsl_"))
	assert.NotContains(t, created.Key, "rsl80_")

	var stored model.Token
	require.NoError(t, db.First(&stored, created.Id).Error)
	assert.Equal(t, 7, stored.UserId)
	assert.Equal(t, 50_000_000, stored.RemainQuota)
	assert.False(t, stored.UnlimitedQuota)
	assert.Equal(t, "default", stored.Group)
	assert.Greater(t, stored.ExpiredTime, stored.CreatedTime)
	var metadata model.ResellerKey
	require.NoError(t, db.Where("token_id = ?", stored.Id).First(&metadata).Error)
	assert.Equal(t, 7, metadata.UserId)
	assert.Equal(t, 50, metadata.TokenMillions)
	assert.Equal(t, 80, metadata.MarkupPercent)
	assert.Equal(t, "0.12", metadata.BaseCostPerMillion)
	assert.Equal(t, "https://pugshop.ru/v1", metadata.Endpoint)
	assert.Equal(t, stored.CreatedTime, metadata.CreatedTime)
	var owner model.User
	require.NoError(t, db.First(&owner, 7).Error)
	assert.Equal(t, 7_000_000, owner.Quota)
}

func TestAddResellerKeyRejectsInsufficientWalletBalance(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id:       12,
		Username: "low-balance-reseller",
		Status:   common.UserStatusEnabled,
		Quota:    599_999,
	}).Error)
	seedActiveResellerSubscription(t, db, 12)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label":   "Client",
		"token_millions": 10,
		"markup_percent": 20,
		"term":           "unlimited",
		"endpoint":       "https://pugshop.ru/v1",
		"request_id":     "controller-low-balance-1",
		"group":          "default",
	}, 12)
	ctx.Set("group", "default")
	AddResellerKey(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "insufficient balance")
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Count(&tokenCount).Error)
	assert.Zero(t, tokenCount)
	var owner model.User
	require.NoError(t, db.First(&owner, 12).Error)
	assert.Equal(t, 599_999, owner.Quota)
}

func TestGetResellerKeysMasksSecretsAndExcludesRegularTokens(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	resellerKey, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	resellerToken := model.Token{
		UserId: 9, Key: resellerKey, Name: "Client", Status: common.TokenStatusEnabled,
		CreatedTime: 10, AccessedTime: 10, ExpiredTime: -1,
		RemainQuota: 9_000_000, UsedQuota: 1_000_000,
	}
	require.NoError(t, db.Create(&resellerToken).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: resellerToken.Id, UserId: 9, TokenMillions: 10, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://snapshot.example", CreatedTime: 10,
	}).Error)
	seedToken(t, db, 9, "Regular", "regular-secret-key")
	foreignKey, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	foreignToken := model.Token{
		UserId: 10, Key: foreignKey, Name: "Foreign", Status: common.TokenStatusEnabled,
		CreatedTime: 10, AccessedTime: 10, ExpiredTime: -1, RemainQuota: 10_000_000,
	}
	require.NoError(t, db.Create(&foreignToken).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: foreignToken.Id, UserId: 10, TokenMillions: 10, MarkupPercent: 50,
		BaseCostPerMillion: "9.99", Endpoint: "https://foreign.example", CreatedTime: 10,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/reseller/keys", nil, 9)
	GetResellerKeys(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var items []resellerKeyResponse
	require.NoError(t, common.Unmarshal(response.Data, &items))
	require.Len(t, items, 1)
	assert.Equal(t, resellerToken.Id, items[0].Id)
	assert.Equal(t, 10, items[0].TokenMillions)
	assert.Equal(t, 9_000_000, items[0].RemainingTokens)
	assert.Equal(t, 1_000_000, items[0].UsedTokens)
	assert.Equal(t, 20, items[0].MarkupPercent)
	assert.Equal(t, 1.2, items[0].Cost)
	assert.Equal(t, 1.44, items[0].ClientPrice)
	assert.Equal(t, 0.12, items[0].BaseCostPerMillion)
	assert.Equal(t, "https://pugshop.ru/v1", items[0].Endpoint)
	assert.Equal(t, "sk-"+resellerToken.GetMaskedKey(), items[0].Key)
	assert.NotContains(t, recorder.Body.String(), resellerToken.Key)
}

func TestGenericTokenUpdateCannotIncreaseResellerAllocation(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	expiresAt := common.GetTimestamp() + 7*24*60*60
	token := model.Token{
		UserId: 15, Key: key, Name: "Paid allocation", Status: common.TokenStatusEnabled,
		CreatedTime: common.GetTimestamp(), AccessedTime: common.GetTimestamp(), ExpiredTime: expiresAt,
		RemainQuota: 10_000_000, UnlimitedQuota: false, Group: "default",
	}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: token.Id, UserId: 15, TokenMillions: 10, MarkupPercent: 50,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: token.CreatedTime,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
		"id":                   token.Id,
		"name":                 "Renamed client",
		"expired_time":         -1,
		"remain_quota":         500_000_000,
		"unlimited_quota":      true,
		"model_limits_enabled": false,
		"model_limits":         "",
		"group":                "default",
		"cross_group_retry":    false,
	}, 15)
	ctx.Request.URL.Path = "/api/token/" + strconv.Itoa(token.Id)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, "Renamed client", stored.Name)
	assert.Equal(t, 10_000_000, stored.RemainQuota)
	assert.False(t, stored.UnlimitedQuota)
	assert.Equal(t, expiresAt, stored.ExpiredTime)
}

func TestGenericTokenPartialUpdatePreservesResellerGroup(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	token := model.Token{
		UserId: 16, Key: key, Name: "Original", Status: common.TokenStatusEnabled,
		CreatedTime: common.GetTimestamp(), AccessedTime: common.GetTimestamp(), ExpiredTime: -1,
		RemainQuota: 1_000_000, UnlimitedQuota: false, Group: "default", QuotaMode: model.TokenQuotaModeTokens,
	}
	require.NoError(t, db.Create(&token).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/"+strconv.Itoa(token.Id), map[string]any{
		"id": token.Id, "name": "Renamed",
	}, 16)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, "Renamed", stored.Name)
	assert.Equal(t, common.TokenStatusEnabled, stored.Status)
	assert.Equal(t, "default", stored.Group)
}

func TestAdjustResellerKeyQuotaChargesAddAndDoesNotRefundSubtract(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	confirmPaymentComplianceForTest(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 46, Username: "quota-adjust-owner", Status: common.UserStatusEnabled,
		Group: "default", Quota: 1_000_000,
	}).Error)
	seedActiveResellerSubscription(t, db, 46)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	now := common.GetTimestamp()
	token := model.Token{
		UserId: 46, Key: key, Name: "Adjustable client", Status: common.TokenStatusEnabled,
		CreatedTime: now, AccessedTime: now, ExpiredTime: -1,
		RemainQuota: 6_000_000, UsedQuota: 4_000_000,
		QuotaMode: model.TokenQuotaModeTokens, Group: "default",
	}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: token.Id, UserId: 46, TokenMillions: 10, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: now,
	}).Error)

	addBody := map[string]any{
		"mode": "add", "token_millions": 2, "expected_total_millions": 10,
		"request_id": "controller-quota-add-1",
	}
	addContext, addRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", addBody, 46,
	)
	addContext.Params = append(addContext.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	addContext.Set("group", "default")
	AdjustResellerKeyQuota(addContext)
	addResponse := decodeAPIResponse(t, addRecorder)
	require.True(t, addResponse.Success, addResponse.Message)
	var added resellerKeyResponse
	require.NoError(t, common.Unmarshal(addResponse.Data, &added))
	assert.Equal(t, 12, added.TokenMillions)
	assert.Equal(t, 8_000_000, added.RemainingTokens)
	assert.Equal(t, 4_000_000, added.UsedTokens)
	var owner model.User
	require.NoError(t, db.First(&owner, 46).Error)
	assert.Equal(t, 880_000, owner.Quota)

	replayContext, replayRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", addBody, 46,
	)
	replayContext.Params = append(replayContext.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	AdjustResellerKeyQuota(replayContext)
	replayResponse := decodeAPIResponse(t, replayRecorder)
	require.True(t, replayResponse.Success, replayResponse.Message)
	require.NoError(t, db.First(&owner, 46).Error)
	assert.Equal(t, 880_000, owner.Quota, "replaying request_id must not charge twice")

	staleContext, staleRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "set", "token_millions": 11, "expected_total_millions": 10,
			"request_id": "controller-quota-stale-set",
		}, 46,
	)
	staleContext.Params = append(staleContext.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	AdjustResellerKeyQuota(staleContext)
	assert.Equal(t, http.StatusConflict, staleRecorder.Code)
	staleResponse := decodeAPIResponse(t, staleRecorder)
	assert.False(t, staleResponse.Success)
	assert.Contains(t, staleResponse.Message, "refresh")

	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Update("expired_time", now-1).Error)
	expiredContext, expiredRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "add", "token_millions": 1, "expected_total_millions": 12,
			"request_id": "controller-quota-expired-add",
		}, 46,
	)
	expiredContext.Params = append(expiredContext.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	expiredContext.Set("group", "default")
	AdjustResellerKeyQuota(expiredContext)
	assert.Equal(t, http.StatusConflict, expiredRecorder.Code)
	expiredResponse := decodeAPIResponse(t, expiredRecorder)
	assert.False(t, expiredResponse.Success)
	assert.Contains(t, expiredResponse.Message, "expired")
	require.NoError(t, db.First(&owner, 46).Error)
	assert.Equal(t, 880_000, owner.Quota, "an expired-key top-up must not debit the wallet")
	var unchangedToken model.Token
	require.NoError(t, db.First(&unchangedToken, token.Id).Error)
	assert.Equal(t, 8_000_000, unchangedToken.RemainQuota)
	var unchangedMetadata model.ResellerKey
	require.NoError(t, db.Where("token_id = ?", token.Id).First(&unchangedMetadata).Error)
	assert.Equal(t, 12, unchangedMetadata.TokenMillions)

	require.NoError(t, db.Model(&model.ResellerSubscription{}).Where("user_id = ?", 46).
		Update("end_time", now-1).Error)
	subtractContext, subtractRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "subtract", "token_millions": 3, "expected_total_millions": 12,
			"request_id": "controller-quota-subtract-1",
		}, 46,
	)
	subtractContext.Params = append(subtractContext.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	AdjustResellerKeyQuota(subtractContext)
	subtractResponse := decodeAPIResponse(t, subtractRecorder)
	require.True(t, subtractResponse.Success, subtractResponse.Message)
	var subtracted resellerKeyResponse
	require.NoError(t, common.Unmarshal(subtractResponse.Data, &subtracted))
	assert.Equal(t, 9, subtracted.TokenMillions)
	assert.Equal(t, 5_000_000, subtracted.RemainingTokens)
	require.NoError(t, db.First(&owner, 46).Error)
	assert.Equal(t, 880_000, owner.Quota, "subtracting quota must not refund the wallet")
	var auditCount int64
	require.NoError(t, db.Model(&model.Log{}).
		Where("user_id = ? AND type = ?", 46, model.LogTypeManage).
		Count(&auditCount).Error)
	assert.EqualValues(t, 2, auditCount, "only newly applied adjustments should create audit entries")
}

func TestAdjustResellerKeyQuotaRequiresStableRequestID(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	token := model.Token{
		UserId: 47, Key: key, Name: "Stable adjustment", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: 1_000_000, QuotaMode: model.TokenQuotaModeTokens, Group: "default",
	}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: token.Id, UserId: 47, TokenMillions: 1, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1",
	}).Error)

	context, recorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "set", "token_millions": 1, "expected_total_millions": 1,
		}, 47,
	)
	context.Params = append(context.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	AdjustResellerKeyQuota(context)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "request_id is required")

	missingExpectedContext, missingExpectedRecorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "set", "token_millions": 1, "request_id": "missing-expected-total",
		}, 47,
	)
	missingExpectedContext.Params = append(
		missingExpectedContext.Params,
		gin.Param{Key: "id", Value: strconv.Itoa(token.Id)},
	)
	AdjustResellerKeyQuota(missingExpectedContext)
	assert.Equal(t, http.StatusBadRequest, missingExpectedRecorder.Code)
	missingExpectedResponse := decodeAPIResponse(t, missingExpectedRecorder)
	assert.False(t, missingExpectedResponse.Success)
	assert.Contains(t, missingExpectedResponse.Message, "invalid reseller quota adjustment request")

	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, 1_000_000, stored.RemainQuota)
}

func TestAdjustResellerKeyQuotaRejectsZeroAllocation(t *testing.T) {
	setupResellerControllerTestDB(t)
	for _, mode := range []string{"set", "subtract"} {
		t.Run(mode, func(t *testing.T) {
			context, recorder := newAuthenticatedContext(
				t, http.MethodPost, "/api/reseller/keys/1/quota", map[string]any{
					"mode": mode, "token_millions": 0, "expected_total_millions": 1,
					"request_id": "zero-" + mode,
				}, 48,
			)
			context.Params = append(context.Params, gin.Param{Key: "id", Value: "1"})

			AdjustResellerKeyQuota(context)

			assert.Equal(t, http.StatusBadRequest, recorder.Code)
			response := decodeAPIResponse(t, recorder)
			assert.False(t, response.Success)
			assert.Contains(t, response.Message, "between 1 and 1000")
		})
	}

	context, recorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/1/quota", map[string]any{
			"mode": "set", "token_millions": 1, "expected_total_millions": 0,
			"request_id": "zero-expected-total",
		}, 48,
	)
	context.Params = append(context.Params, gin.Param{Key: "id", Value: "1"})
	AdjustResellerKeyQuota(context)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "expected total must be between 1 and 1000")
}

func TestAdjustResellerKeyQuotaRejectsInsufficientWallet(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	confirmPaymentComplianceForTest(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 49, Username: "quota-adjust-empty-wallet", Status: common.UserStatusEnabled,
		Group: "default", Quota: 10,
	}).Error)
	seedActiveResellerSubscription(t, db, 49)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	now := common.GetTimestamp()
	token := model.Token{
		UserId: 49, Key: key, Name: "No funds", Status: common.TokenStatusEnabled,
		CreatedTime: now, AccessedTime: now, ExpiredTime: -1,
		RemainQuota: 1_000_000, QuotaMode: model.TokenQuotaModeTokens, Group: "default",
	}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: token.Id, UserId: 49, TokenMillions: 1, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: now,
	}).Error)
	context, recorder := newAuthenticatedContext(
		t, http.MethodPost, "/api/reseller/keys/"+strconv.Itoa(token.Id)+"/quota", map[string]any{
			"mode": "add", "token_millions": 1, "expected_total_millions": 1,
			"request_id": "insufficient-wallet-add",
		}, 49,
	)
	context.Params = append(context.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	context.Set("group", "default")

	AdjustResellerKeyQuota(context)

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "insufficient balance")
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, 1_000_000, stored.RemainQuota)
	var metadata model.ResellerKey
	require.NoError(t, db.Where("token_id = ?", token.Id).First(&metadata).Error)
	assert.Equal(t, 1, metadata.TokenMillions)
	var owner model.User
	require.NoError(t, db.First(&owner, 49).Error)
	assert.Equal(t, 10, owner.Quota)
}

func TestAddResellerKeyRejectsInvalidRequest(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	tests := []map[string]any{
		{"client_label": "client", "token_millions": 0, "markup_percent": 20, "term": "unlimited", "endpoint": "https://pugshop.ru/v1", "group": "default"},
		{"client_label": "client", "token_millions": 1001, "markup_percent": 20, "term": "unlimited", "endpoint": "https://pugshop.ru/v1", "group": "default"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 10, "term": "unlimited", "endpoint": "https://pugshop.ru/v1", "group": "default"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 20, "term": "forever", "endpoint": "https://pugshop.ru/v1", "group": "default"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 20, "term": "unlimited", "endpoint": "https://other.example", "group": "default"},
	}
	for _, body := range tests {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", body, 11)
		ctx.Set("group", "default")
		AddResellerKey(ctx)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, "%v", body)
		response := decodeAPIResponse(t, recorder)
		assert.False(t, response.Success, "%v", body)
	}
	var count int64
	require.NoError(t, db.Model(&model.Token{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAddResellerKeyRequiresStableRequestIDAndReplays(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	originalSettings := operation_setting.GetResellerSetting()
	t.Cleanup(func() { operation_setting.SetResellerSetting(originalSettings) })
	originalGroups := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalGroups))
	})
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 32, Username: "idempotent-reseller", Status: common.UserStatusEnabled, Quota: 10_000_000,
	}).Error)
	seedActiveResellerSubscription(t, db, 32)

	baseRequest := map[string]any{
		"client_label": "Stable client", "token_millions": 10,
		"markup_percent": 20, "term": "unlimited", "group": "default",
		"endpoint": strings.TrimRight(originalSettings.Endpoint, "/"),
	}
	missingContext, missingRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", baseRequest, 32)
	missingContext.Set("group", "default")
	AddResellerKey(missingContext)
	assert.Equal(t, http.StatusBadRequest, missingRecorder.Code)

	firstRequest := make(map[string]any, len(baseRequest)+1)
	for key, value := range baseRequest {
		firstRequest[key] = value
	}
	firstRequest["request_id"] = "stable-issue-1"
	firstContext, firstRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", firstRequest, 32)
	firstContext.Set("group", "default")
	AddResellerKey(firstContext)
	firstResponse := decodeAPIResponse(t, firstRecorder)
	require.True(t, firstResponse.Success, firstResponse.Message)
	var first resellerKeyResponse
	require.NoError(t, common.Unmarshal(firstResponse.Data, &first))
	changedSettings := originalSettings
	changedSettings.Endpoint = "https://changed-reseller.example/v1"
	operation_setting.SetResellerSetting(changedSettings)

	secondRequest := make(map[string]any, len(baseRequest)+1)
	for key, value := range baseRequest {
		secondRequest[key] = value
	}
	secondRequest["client_label"] = "Changed retry payload"
	secondRequest["token_millions"] = 50
	secondRequest["request_id"] = "stable-issue-1"
	secondContext, secondRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", secondRequest, 32)
	secondContext.Set("group", "default")
	AddResellerKey(secondContext)
	secondResponse := decodeAPIResponse(t, secondRecorder)
	require.True(t, secondResponse.Success, secondResponse.Message)
	var replay resellerKeyResponse
	require.NoError(t, common.Unmarshal(secondResponse.Data, &replay))
	assert.Equal(t, first.Id, replay.Id)
	assert.Equal(t, first.Key, replay.Key)
	assert.Equal(t, 10, replay.TokenMillions)

	operation_setting.SetResellerSetting(originalSettings)
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
	thirdContext, thirdRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", secondRequest, 32)
	thirdContext.Set("group", "default")
	AddResellerKey(thirdContext)
	thirdResponse := decodeAPIResponse(t, thirdRecorder)
	require.True(t, thirdResponse.Success, thirdResponse.Message)
	var groupReplay resellerKeyResponse
	require.NoError(t, common.Unmarshal(thirdResponse.Data, &groupReplay))
	assert.Equal(t, first.Id, groupReplay.Id)
	assert.Equal(t, first.Key, groupReplay.Key)

	var owner model.User
	require.NoError(t, db.First(&owner, 32).Error)
	assert.Equal(t, 9_400_000, owner.Quota, "retry must not debit a second package")
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", 32).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
}

func TestAddResellerKeyLimitsClientLabelByCharacters(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 31, Username: "unicode-reseller", Status: common.UserStatusEnabled, Quota: 1_000_000,
	}).Error)
	seedActiveResellerSubscription(t, db, 31)

	acceptedContext, acceptedRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label": strings.Repeat("я", 50), "token_millions": 1,
		"markup_percent": 20, "term": "unlimited", "request_id": "unicode-accepted", "group": "default",
	}, 31)
	acceptedContext.Set("group", "default")
	AddResellerKey(acceptedContext)
	accepted := decodeAPIResponse(t, acceptedRecorder)
	require.True(t, accepted.Success, accepted.Message)

	rejectedContext, rejectedRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label": strings.Repeat("я", 51), "token_millions": 1,
		"markup_percent": 20, "term": "unlimited", "request_id": "unicode-rejected", "group": "default",
	}, 31)
	rejectedContext.Set("group", "default")
	AddResellerKey(rejectedContext)
	assert.Equal(t, http.StatusBadRequest, rejectedRecorder.Code)
	rejected := decodeAPIResponse(t, rejectedRecorder)
	assert.False(t, rejected.Success)
}

func TestResellerKeysCanBeRevealedAndDeletedWithoutQuotaRefund(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	token := model.Token{
		UserId: 21, Key: key, Name: "Protected", Status: common.TokenStatusEnabled,
		CreatedTime: 10, AccessedTime: 10, ExpiredTime: -1, RemainQuota: 1_000_000,
	}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: token.Id, UserId: 21, TokenMillions: 1, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: 10,
	}).Error)

	keyCtx, keyRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/"+strconv.Itoa(token.Id)+"/key", nil, 21)
	keyCtx.Params = append(keyCtx.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	GetTokenKey(keyCtx)
	keyResponse := decodeAPIResponse(t, keyRecorder)
	require.True(t, keyResponse.Success, keyResponse.Message)
	assert.Contains(t, keyRecorder.Body.String(), key)

	deleteCtx, deleteRecorder := newAuthenticatedContext(t, http.MethodDelete, "/api/token/"+strconv.Itoa(token.Id), nil, 21)
	deleteCtx.Params = append(deleteCtx.Params, gin.Param{Key: "id", Value: strconv.Itoa(token.Id)})
	DeleteToken(deleteCtx)
	deleteResponse := decodeAPIResponse(t, deleteRecorder)
	assert.True(t, deleteResponse.Success, deleteResponse.Message)
	assert.ErrorIs(t, db.First(&model.Token{}, token.Id).Error, gorm.ErrRecordNotFound)
	assert.ErrorIs(t, db.Where("token_id = ?", token.Id).First(&model.ResellerKey{}).Error, gorm.ErrRecordNotFound)

	regular := seedToken(t, db, 21, "Regular", "regular-for-protected-batch")
	batchKey, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	batchToken := model.Token{
		UserId: 21, Key: batchKey, Name: "Batch reseller", Status: common.TokenStatusEnabled,
		CreatedTime: 11, AccessedTime: 11, ExpiredTime: -1, RemainQuota: 2_000_000,
	}
	require.NoError(t, db.Create(&batchToken).Error)
	require.NoError(t, db.Create(&model.ResellerKey{
		TokenId: batchToken.Id, UserId: 21, TokenMillions: 2, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: 11,
	}).Error)
	batchCtx, batchRecorder := newAuthenticatedContext(t, http.MethodDelete, "/api/token/batch", map[string]any{
		"ids": []int{regular.Id, batchToken.Id},
	}, 21)
	DeleteTokenBatch(batchCtx)
	batchResponse := decodeAPIResponse(t, batchRecorder)
	assert.True(t, batchResponse.Success, batchResponse.Message)
	assert.ErrorIs(t, db.First(&model.Token{}, regular.Id).Error, gorm.ErrRecordNotFound)
	assert.ErrorIs(t, db.First(&model.Token{}, batchToken.Id).Error, gorm.ErrRecordNotFound)
	assert.ErrorIs(t, db.Where("token_id = ?", batchToken.Id).First(&model.ResellerKey{}).Error, gorm.ErrRecordNotFound)
}

func TestPurchaseResellerSubscriptionIsIdempotent(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	confirmPaymentComplianceForTest(t)
	originalSettings := operation_setting.GetResellerSetting()
	t.Cleanup(func() { operation_setting.SetResellerSetting(originalSettings) })
	originalGroups := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalGroups))
	})
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 41, Username: "subscription-buyer", Status: common.UserStatusEnabled, Quota: 6_000_000,
	}).Error)

	request := map[string]any{"request_id": "subscription-controller-1"}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/subscription", request, 41)
	ctx.Set("group", "default")
	PurchaseResellerSubscription(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var subscription resellerSubscriptionResponse
	require.NoError(t, common.Unmarshal(response.Data, &subscription))
	assert.True(t, subscription.Active)
	assert.Equal(t, 10.0, subscription.Price)
	assert.Equal(t, 30, subscription.DurationDays)

	invalidCurrentSettings := originalSettings
	invalidCurrentSettings.SubscriptionPrice = 0
	invalidCurrentSettings.SubscriptionDurationDays = 0
	operation_setting.SetResellerSetting(invalidCurrentSettings)
	replayCtx, replayRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/subscription", request, 41)
	replayCtx.Set("group", "default")
	PurchaseResellerSubscription(replayCtx)
	replay := decodeAPIResponse(t, replayRecorder)
	require.True(t, replay.Success, replay.Message)
	var replayedSubscription resellerSubscriptionResponse
	require.NoError(t, common.Unmarshal(replay.Data, &replayedSubscription))
	assert.Equal(t, subscription.Price, replayedSubscription.Price)
	assert.Equal(t, subscription.DurationDays, replayedSubscription.DurationDays)

	operation_setting.SetResellerSetting(originalSettings)
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
	groupReplayCtx, groupReplayRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/subscription", request, 41)
	groupReplayCtx.Set("group", "default")
	PurchaseResellerSubscription(groupReplayCtx)
	groupReplay := decodeAPIResponse(t, groupReplayRecorder)
	require.True(t, groupReplay.Success, groupReplay.Message)

	var owner model.User
	require.NoError(t, db.First(&owner, 41).Error)
	assert.Equal(t, 1_000_000, owner.Quota)
	var count int64
	require.NoError(t, db.Model(&model.ResellerSubscription{}).Where("user_id = ?", 41).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestPurchaseResellerSubscriptionRequiresPaymentCompliance(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = false
	paymentSetting.ComplianceTermsVersion = ""
	require.NoError(t, db.Create(&model.User{
		Id: 43, Username: "unconfirmed-subscription-buyer", Status: common.UserStatusEnabled, Quota: 6_000_000,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/subscription", map[string]any{
		"request_id": "subscription-without-compliance",
	}, 43)
	PurchaseResellerSubscription(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	var owner model.User
	require.NoError(t, db.First(&owner, 43).Error)
	assert.Equal(t, 6_000_000, owner.Quota)
	var count int64
	require.NoError(t, db.Model(&model.ResellerSubscription{}).Where("user_id = ?", 43).Count(&count).Error)
	assert.Zero(t, count)
}

func TestPurchaseResellerSubscriptionRequiresSelectableRoutingGroup(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	confirmPaymentComplianceForTest(t)
	previousGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups))
	})
	require.NoError(t, db.Create(&model.User{
		Id:       44,
		Username: "subscription-buyer-without-route",
		Status:   common.UserStatusEnabled,
		Group:    "reseller-test-without-ratio",
		Quota:    6_000_000,
	}).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/subscription", map[string]any{
		"request_id": "subscription-without-route",
	}, 44)
	ctx.Set("group", "reseller-test-without-ratio")
	PurchaseResellerSubscription(ctx)

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Equal(t, "no routing groups are available for reseller keys", response.Message)
	var owner model.User
	require.NoError(t, db.First(&owner, 44).Error)
	assert.Equal(t, 6_000_000, owner.Quota)
	var count int64
	require.NoError(t, db.Model(&model.ResellerSubscription{}).Where("user_id = ?", 44).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAddResellerKeyRequiresSubscriptionAndConcreteGroup(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 42, Username: "subscription-required", Status: common.UserStatusEnabled, Quota: 1_000_000,
	}).Error)
	request := map[string]any{
		"client_label": "Client", "token_millions": 1, "markup_percent": 20,
		"term": "unlimited", "group": "default", "request_id": "gated-key-1",
	}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", request, 42)
	ctx.Set("group", "default")
	AddResellerKey(ctx)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.False(t, decodeAPIResponse(t, recorder).Success)

	seedActiveResellerSubscription(t, db, 42)
	request["group"] = "auto"
	invalidGroupCtx, invalidGroupRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", request, 42)
	invalidGroupCtx.Set("group", "default")
	AddResellerKey(invalidGroupCtx)
	assert.Equal(t, http.StatusBadRequest, invalidGroupRecorder.Code)
	var count int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", 42).Count(&count).Error)
	assert.Zero(t, count)
}

func TestGetResellerConfigReturnsSafeSettings(t *testing.T) {
	setupResellerControllerTestDB(t)
	settings := operation_setting.GetResellerSetting()
	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/reseller/config", nil, 1)
	ctx.Set("group", "default")
	GetResellerConfig(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	var data struct {
		BaseCostPerMillion float64                      `json:"base_cost_per_million"`
		DefaultEndpoint    string                       `json:"default_endpoint"`
		AvailableGroups    []resellerAvailableGroup     `json:"available_groups"`
		Subscription       resellerSubscriptionResponse `json:"subscription"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &data))
	assert.Equal(t, settings.BaseCostPerMillion, data.BaseCostPerMillion)
	assert.Equal(t, strings.TrimRight(settings.Endpoint, "/"), data.DefaultEndpoint)
	require.NotEmpty(t, data.AvailableGroups)
	assert.Equal(t, "default", data.AvailableGroups[0].Name)
	assert.False(t, data.Subscription.Active)
	assert.Equal(t, settings.SubscriptionPrice, data.Subscription.ListPrice)
	assert.Equal(t, settings.SubscriptionDurationDays, data.Subscription.DurationDays)
}

func TestGetResellerAvailableGroupsExcludesGroupsWithoutEnabledModels(t *testing.T) {
	setupResellerControllerTestDB(t)
	configureResellerGroupEligibilityTest(t)

	groups := getResellerAvailableGroups("default")

	require.Len(t, groups, 1)
	assert.Equal(t, "default", groups[0].Name)
	assert.True(t, isResellerGroupAvailable("default", "default"))
	assert.False(t, isResellerGroupAvailable("default", "empty"))
}

func TestAddResellerKeyRejectsGroupWithoutEnabledModels(t *testing.T) {
	db := setupResellerControllerTestDB(t)
	configureResellerGroupEligibilityTest(t)
	require.NoError(t, db.Create(&model.User{
		Id:       45,
		Username: "reseller-empty-route",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    1_000_000,
	}).Error)
	seedActiveResellerSubscription(t, db, 45)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label": "Unroutable client", "token_millions": 1,
		"markup_percent": 20, "term": "unlimited", "group": "empty",
		"request_id": "empty-route-key",
	}, 45)
	ctx.Set("group", "default")
	AddResellerKey(ctx)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.Equal(t, "a concrete available routing group is required", response.Message)
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", 45).Count(&tokenCount).Error)
	assert.Zero(t, tokenCount)
	var owner model.User
	require.NoError(t, db.First(&owner, 45).Error)
	assert.Equal(t, 1_000_000, owner.Quota)
}

func seedActiveResellerSubscription(t *testing.T, db *gorm.DB, userId int) {
	t.Helper()
	now := common.GetTimestamp()
	require.NoError(t, db.Create(&model.ResellerSubscription{
		UserId: userId, Status: model.ResellerSubscriptionStatusActive,
		StartTime: now - 1, EndTime: now + 24*60*60,
		ListPrice: "10.00", PaidPrice: "10.00", ChargedQuota: 5_000_000,
		DurationDays: 30, RequestId: "test-active", CreatedTime: now - 1,
	}).Error)
}
