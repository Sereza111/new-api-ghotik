package controller

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateRawTokenQuotaPreservesStaleAllocationOnMetadataPatch(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := &model.Token{
		UserId: 201, Key: "raw-update-key", Name: "before", Status: common.TokenStatusEnabled,
		CreatedTime: 1, AccessedTime: 1, ExpiredTime: 100, RemainQuota: 2_000_000,
		QuotaMode: model.TokenQuotaModeTokens,
	}
	require.NoError(t, db.Create(token).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/"+strconv.Itoa(token.Id), map[string]any{
		"id":              token.Id,
		"name":            "after",
		"expired_time":    200,
		"remain_quota":    1,
		"unlimited_quota": true,
	}, 201)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, "after", stored.Name)
	assert.Equal(t, 2_000_000, stored.RemainQuota)
	assert.False(t, stored.UnlimitedQuota)
	assert.Equal(t, int64(200), stored.ExpiredTime)
	assert.Equal(t, model.TokenQuotaModeTokens, stored.EffectiveQuotaMode())
}

func TestUpdateRawTokenQuotaIgnoresExplicitAllocationChange(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := &model.Token{
		UserId: 202, Key: "raw-update-key-2", Name: "immutable", Status: common.TokenStatusEnabled,
		CreatedTime: 1, AccessedTime: 1, ExpiredTime: -1, RemainQuota: 2_000_000,
		QuotaMode: model.TokenQuotaModeTokens,
	}
	require.NoError(t, db.Create(token).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/"+strconv.Itoa(token.Id), map[string]any{
		"id":           token.Id,
		"name":         "attempt",
		"remain_quota": 1_000_000,
	}, 202)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, "attempt", stored.Name)
	assert.Equal(t, 2_000_000, stored.RemainQuota)
}

func TestUpdateRawTokenQuotaRejectsModeChange(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	token := &model.Token{
		UserId: 203, Key: "raw-update-key-3", Name: "mode", Status: common.TokenStatusEnabled,
		CreatedTime: 1, AccessedTime: 1, ExpiredTime: -1, RemainQuota: 2_000_000,
		QuotaMode: model.TokenQuotaModeTokens,
	}
	require.NoError(t, db.Create(token).Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/"+strconv.Itoa(token.Id), map[string]any{
		"id":         token.Id,
		"name":       "attempt",
		"quota_mode": model.TokenQuotaModeMoney,
	}, 203)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, model.TokenQuotaModeTokens, stored.EffectiveQuotaMode())
}
