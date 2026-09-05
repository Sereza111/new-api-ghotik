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
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAddResellerKeyCreatesUsableToken(t *testing.T) {
	db := setupTokenControllerTestDB(t)
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
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label":   "Acme Studio",
		"token_millions": 50,
		"markup_percent": 80,
		"term":           "30-days",
		"endpoint":       "https://pugshop.ru/v1",
		"request_id":     "controller-create-1",
	}, 7)

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
	assert.True(t, strings.HasPrefix(created.Key, "sk-rsl_"))
	assert.NotContains(t, created.Key, "rsl80_")

	var stored model.Token
	require.NoError(t, db.First(&stored, created.Id).Error)
	assert.Equal(t, 7, stored.UserId)
	assert.Equal(t, 50_000_000, stored.RemainQuota)
	assert.False(t, stored.UnlimitedQuota)
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
	db := setupTokenControllerTestDB(t)
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

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label":   "Client",
		"token_millions": 10,
		"markup_percent": 20,
		"term":           "unlimited",
		"endpoint":       "https://pugshop.ru/v1",
		"request_id":     "controller-low-balance-1",
	}, 12)
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
	db := setupTokenControllerTestDB(t)
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
	assert.Equal(t, "https://pugshop.ru/v1", items[0].Endpoint)
	assert.Equal(t, "sk-"+resellerToken.GetMaskedKey(), items[0].Key)
	assert.NotContains(t, recorder.Body.String(), resellerToken.Key)
}

func TestGenericTokenUpdateCannotIncreaseResellerAllocation(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	key, err := model.NewResellerTokenKey()
	require.NoError(t, err)
	expiresAt := common.GetTimestamp() + 7*24*60*60
	token := model.Token{
		UserId: 15, Key: key, Name: "Paid allocation", Status: common.TokenStatusEnabled,
		CreatedTime: common.GetTimestamp(), AccessedTime: common.GetTimestamp(), ExpiredTime: expiresAt,
		RemainQuota: 10_000_000, UnlimitedQuota: false,
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

func TestAddResellerKeyRejectsInvalidRequest(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	tests := []map[string]any{
		{"client_label": "client", "token_millions": 0, "markup_percent": 20, "term": "unlimited", "endpoint": "https://pugshop.ru/v1"},
		{"client_label": "client", "token_millions": 1001, "markup_percent": 20, "term": "unlimited", "endpoint": "https://pugshop.ru/v1"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 10, "term": "unlimited", "endpoint": "https://pugshop.ru/v1"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 20, "term": "forever", "endpoint": "https://pugshop.ru/v1"},
		{"client_label": "client", "token_millions": 10, "markup_percent": 20, "term": "unlimited", "endpoint": "https://other.example"},
	}
	for _, body := range tests {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", body, 11)
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
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 32, Username: "idempotent-reseller", Status: common.UserStatusEnabled, Quota: 10_000_000,
	}).Error)

	baseRequest := map[string]any{
		"client_label": "Stable client", "token_millions": 10,
		"markup_percent": 20, "term": "unlimited",
	}
	missingContext, missingRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", baseRequest, 32)
	AddResellerKey(missingContext)
	assert.Equal(t, http.StatusBadRequest, missingRecorder.Code)

	firstRequest := make(map[string]any, len(baseRequest)+1)
	for key, value := range baseRequest {
		firstRequest[key] = value
	}
	firstRequest["request_id"] = "stable-issue-1"
	firstContext, firstRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", firstRequest, 32)
	AddResellerKey(firstContext)
	firstResponse := decodeAPIResponse(t, firstRecorder)
	require.True(t, firstResponse.Success, firstResponse.Message)
	var first resellerKeyResponse
	require.NoError(t, common.Unmarshal(firstResponse.Data, &first))

	secondRequest := make(map[string]any, len(baseRequest)+1)
	for key, value := range baseRequest {
		secondRequest[key] = value
	}
	secondRequest["client_label"] = "Changed retry payload"
	secondRequest["token_millions"] = 50
	secondRequest["request_id"] = "stable-issue-1"
	secondContext, secondRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", secondRequest, 32)
	AddResellerKey(secondContext)
	secondResponse := decodeAPIResponse(t, secondRecorder)
	require.True(t, secondResponse.Success, secondResponse.Message)
	var replay resellerKeyResponse
	require.NoError(t, common.Unmarshal(secondResponse.Data, &replay))
	assert.Equal(t, first.Id, replay.Id)
	assert.Equal(t, first.Key, replay.Key)
	assert.Equal(t, 10, replay.TokenMillions)
	var owner model.User
	require.NoError(t, db.First(&owner, 32).Error)
	assert.Equal(t, 9_400_000, owner.Quota, "retry must not debit a second package")
	var tokenCount int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", 32).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
}

func TestAddResellerKeyLimitsClientLabelByCharacters(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	require.NoError(t, db.Create(&model.User{
		Id: 31, Username: "unicode-reseller", Status: common.UserStatusEnabled, Quota: 1_000_000,
	}).Error)

	acceptedContext, acceptedRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label": strings.Repeat("я", 50), "token_millions": 1,
		"markup_percent": 20, "term": "unlimited", "request_id": "unicode-accepted",
	}, 31)
	AddResellerKey(acceptedContext)
	accepted := decodeAPIResponse(t, acceptedRecorder)
	require.True(t, accepted.Success, accepted.Message)

	rejectedContext, rejectedRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/reseller/keys", map[string]any{
		"client_label": strings.Repeat("я", 51), "token_millions": 1,
		"markup_percent": 20, "term": "unlimited", "request_id": "unicode-rejected",
	}, 31)
	AddResellerKey(rejectedContext)
	assert.Equal(t, http.StatusBadRequest, rejectedRecorder.Code)
	rejected := decodeAPIResponse(t, rejectedRecorder)
	assert.False(t, rejected.Success)
}

func TestResellerKeysCanBeIndividuallyRevealedButCannotBeDeleted(t *testing.T) {
	db := setupTokenControllerTestDB(t)
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
	assert.False(t, deleteResponse.Success)
	require.NoError(t, db.First(&model.Token{}, token.Id).Error)

	regular := seedToken(t, db, 21, "Regular", "regular-for-protected-batch")
	batchCtx, batchRecorder := newAuthenticatedContext(t, http.MethodDelete, "/api/token/batch", map[string]any{
		"ids": []int{regular.Id, token.Id},
	}, 21)
	DeleteTokenBatch(batchCtx)
	batchResponse := decodeAPIResponse(t, batchRecorder)
	assert.False(t, batchResponse.Success)
	require.NoError(t, db.First(&model.Token{}, regular.Id).Error)
	require.NoError(t, db.First(&model.Token{}, token.Id).Error)
}

func TestGetResellerConfigReturnsSafeSettings(t *testing.T) {
	settings := operation_setting.GetResellerSetting()
	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/reseller/config", nil, 1)
	GetResellerConfig(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	var data struct {
		BaseCostPerMillion float64 `json:"base_cost_per_million"`
		DefaultEndpoint    string  `json:"default_endpoint"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &data))
	assert.Equal(t, settings.BaseCostPerMillion, data.BaseCostPerMillion)
	assert.Equal(t, strings.TrimRight(settings.Endpoint, "/"), data.DefaultEndpoint)
}
