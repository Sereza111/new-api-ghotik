package model

import (
	"testing"
	"time"

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

func TestRevokeTelegramChannelBonusWithinThirtyDaysDebitsExactlyOnce(t *testing.T) {
	truncateTables(t)
	now := time.Unix(1_800_000_000, 0)
	user := User{
		Username:   "telegram-bonus-revoke",
		Password:   "password",
		Status:     common.UserStatusEnabled,
		TelegramId: "1122334455",
		Quota:      100,
	}
	require.NoError(t, DB.Create(&user).Error)
	bonus := TelegramChannelBonus{
		UserId:       user.Id,
		TelegramId:   user.TelegramId,
		Channel:      "@VL_API",
		QuotaAwarded: 250_000,
		CreatedAt:    now.Add(-7 * 24 * time.Hour).Unix(),
	}
	require.NoError(t, DB.Create(&bonus).Error)

	revoked, changed, err := RevokeTelegramChannelBonus(
		user.TelegramId,
		"@VL_API",
		now,
		30*24*time.Hour,
	)
	require.NoError(t, err)
	assert.True(t, changed)
	assert.Equal(t, now.Unix(), revoked.RevokedAt)
	assert.Equal(t, "left_channel", revoked.RevocationReason)

	var reloaded User
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, -249_900, reloaded.Quota)

	_, changed, err = RevokeTelegramChannelBonus(
		user.TelegramId,
		"@VL_API",
		now.Add(time.Minute),
		30*24*time.Hour,
	)
	require.NoError(t, err)
	assert.False(t, changed)
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, -249_900, reloaded.Quota)
}

func TestRevokeTelegramChannelBonusKeepsRewardAfterThirtyDays(t *testing.T) {
	truncateTables(t)
	now := time.Unix(1_800_000_000, 0)
	user := User{
		Username:   "telegram-bonus-retained",
		Password:   "password",
		Status:     common.UserStatusEnabled,
		TelegramId: "9988776655",
		Quota:      250_100,
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, DB.Create(&TelegramChannelBonus{
		UserId:       user.Id,
		TelegramId:   user.TelegramId,
		Channel:      "@VL_API",
		QuotaAwarded: 250_000,
		CreatedAt:    now.Add(-30*24*time.Hour - time.Second).Unix(),
	}).Error)

	_, changed, err := RevokeTelegramChannelBonus(
		user.TelegramId,
		"@VL_API",
		now,
		30*24*time.Hour,
	)
	require.NoError(t, err)
	assert.False(t, changed)

	var reloaded User
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)
}
