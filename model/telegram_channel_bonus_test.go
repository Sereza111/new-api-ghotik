package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaimTelegramChannelBonusCreditsLinkedUserExactlyOnce(t *testing.T) {
	truncateTables(t)
	user := User{
		Username:   "telegram-bonus-user",
		Password:   "password",
		Status:     common.UserStatusEnabled,
		TelegramId: "123456789",
		Quota:      100,
	}
	require.NoError(t, DB.Create(&user).Error)

	bonus, err := ClaimTelegramChannelBonus(user.TelegramId, "@VL_API", 250_000)
	require.NoError(t, err)
	assert.Equal(t, user.Id, bonus.UserId)
	assert.Equal(t, 250_000, bonus.QuotaAwarded)

	var reloaded User
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)

	_, err = ClaimTelegramChannelBonus(user.TelegramId, "@VL_API", 250_000)
	assert.ErrorIs(t, err, ErrTelegramChannelBonusAlreadyClaimed)
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)
}

func TestClaimTelegramChannelBonusRequiresLinkedEnabledUser(t *testing.T) {
	truncateTables(t)

	_, err := ClaimTelegramChannelBonus("missing", "@VL_API", 250_000)
	assert.ErrorIs(t, err, ErrTelegramChannelBonusUserNotFound)

	user := User{
		Username:   "disabled-telegram-bonus-user",
		Password:   "password",
		Status:     common.UserStatusDisabled,
		TelegramId: "987654321",
	}
	require.NoError(t, DB.Create(&user).Error)
	_, err = ClaimTelegramChannelBonus(user.TelegramId, "@VL_API", 250_000)
	assert.ErrorIs(t, err, ErrTelegramChannelBonusUserDisabled)
}
