package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokenUpdateUsesPersistedRawModeForPartialLegacySnapshot(t *testing.T) {
	truncateTables(t)
	token := &Token{
		UserId:       901,
		Key:          "raw-partial-update-key",
		Name:         "before",
		Status:       common.TokenStatusEnabled,
		CreatedTime:  1,
		AccessedTime: 1,
		ExpiredTime:  -1,
		RemainQuota:  2_000_000,
		UsedQuota:    500_000,
		QuotaMode:    TokenQuotaModeTokens,
	}
	require.NoError(t, DB.Create(token).Error)

	// Simulate a legacy/partial caller that does not carry QuotaMode or the
	// current allocation. Update must resolve the persisted mode and leave the
	// raw reservation untouched.
	partial := &Token{
		Id:             token.Id,
		Name:           "after",
		Status:         common.TokenStatusEnabled,
		QuotaMode:      "",
		RemainQuota:    0,
		UnlimitedQuota: false,
	}
	require.NoError(t, partial.Update())

	var stored Token
	require.NoError(t, DB.First(&stored, token.Id).Error)
	assert.Equal(t, "after", stored.Name)
	assert.Equal(t, 2_000_000, stored.RemainQuota)
	assert.Equal(t, 500_000, stored.UsedQuota)
	assert.False(t, stored.UnlimitedQuota)
	assert.Equal(t, TokenQuotaModeTokens, stored.EffectiveQuotaMode())
}
