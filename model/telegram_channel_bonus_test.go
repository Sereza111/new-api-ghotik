package model

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func enableReferralRewardsForTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	originalInviterQuota := common.QuotaForInviter
	originalPercent := setting.ReferralTopUpRewardPercent
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
		common.QuotaForInviter = originalInviterQuota
		setting.ReferralTopUpRewardPercent = originalPercent
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

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

func TestReferralLevelProgression(t *testing.T) {
	tests := []struct {
		name             string
		qualified        int
		code             string
		currentThreshold int
		nextThreshold    *int
		progress         float64
		discountPercent  float64
	}{
		{name: "negative starts at zero", qualified: -1, code: "starter", currentThreshold: 0, nextThreshold: intPointer(5), progress: 0, discountPercent: 0},
		{name: "bronze", qualified: 5, code: "bronze", currentThreshold: 5, nextThreshold: intPointer(20), progress: 0, discountPercent: 1},
		{name: "silver progress", qualified: 35, code: "silver", currentThreshold: 20, nextThreshold: intPointer(50), progress: 50, discountPercent: 2},
		{name: "gold", qualified: 50, code: "gold", currentThreshold: 50, nextThreshold: nil, progress: 100, discountPercent: 3},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			level := ResolveReferralLevel(test.qualified)
			assert.Equal(t, test.code, level.Code)
			assert.Equal(t, test.currentThreshold, level.CurrentThreshold)
			assert.Equal(t, test.nextThreshold, level.NextThreshold)
			assert.InDelta(t, test.progress, level.ProgressPercent, 0.001)
			assert.InDelta(t, test.discountPercent, level.TopUpFeeDiscountPercent, 0.001)
		})
	}
}

func TestUserReferralLevelSettlesOnlyMatureRewards(t *testing.T) {
	truncateTables(t)
	inviter := User{Username: "level-maturity-inviter", Status: common.UserStatusEnabled, AffCode: "level-maturity-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	now := time.Now().Unix()
	for index := 0; index < 5; index++ {
		require.NoError(t, DB.Create(&ReferralReward{
			InviterId: inviter.Id, InviteeId: 100 + index,
			RewardType: ReferralRewardTypeTelegramSubscription, SourceId: 200 + index,
			RewardQuota: 1, Status: ReferralRewardStatusPending,
			AvailableAt: now - 1, CreatedAt: now - int64(telegramReferralQualificationWindow/time.Second),
		}).Error)
	}
	require.NoError(t, DB.Create(&ReferralReward{
		InviterId: inviter.Id, InviteeId: 999,
		RewardType: ReferralRewardTypeTelegramSubscription, SourceId: 999,
		RewardQuota: 1, Status: ReferralRewardStatusPending,
		AvailableAt: now + int64(time.Hour/time.Second), CreatedAt: now,
	}).Error)

	level, err := GetUserReferralLevel(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, "bronze", level.Code)
	var availableCount int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("inviter_id = ? AND status = ?", inviter.Id, ReferralRewardStatusAvailable).Count(&availableCount).Error)
	assert.EqualValues(t, 5, availableCount)
	var pendingCount int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("inviter_id = ? AND status = ?", inviter.Id, ReferralRewardStatusPending).Count(&pendingCount).Error)
	assert.EqualValues(t, 1, pendingCount)
}

func intPointer(value int) *int {
	return &value
}

func TestUserInsertPersistsInviterAndCountsRegistrationWithoutImmediateReward(t *testing.T) {
	truncateTables(t)
	originalNewUserQuota := common.QuotaForNewUser
	originalInviteeQuota := common.QuotaForInvitee
	originalInviterQuota := common.QuotaForInviter
	t.Cleanup(func() {
		common.QuotaForNewUser = originalNewUserQuota
		common.QuotaForInvitee = originalInviteeQuota
		common.QuotaForInviter = originalInviterQuota
	})
	common.QuotaForNewUser = 0
	common.QuotaForInvitee = 0
	common.QuotaForInviter = 0

	inviter := User{Username: "registration-inviter", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{Username: "registration-invitee", Password: "password123", Status: common.UserStatusEnabled}
	require.NoError(t, invitee.Insert(inviter.Id))
	assert.Equal(t, inviter.Id, invitee.InviterId)

	var reloadedInviter User
	require.NoError(t, DB.First(&reloadedInviter, inviter.Id).Error)
	assert.Equal(t, 1, reloadedInviter.AffCount)
	assert.Zero(t, reloadedInviter.AffQuota)
	assert.Zero(t, reloadedInviter.AffHistoryQuota)
}

func TestTelegramReferralRewardQualifiesAndRevokesWithChannelBonus(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	common.QuotaForInviter = 125_000

	inviter := User{Username: "channel-referral-inviter", Status: common.UserStatusEnabled, AffCode: "ch-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username:   "channel-referral-invitee",
		Status:     common.UserStatusEnabled,
		TelegramId: "referral-telegram-id",
		InviterId:  inviter.Id,
		Quota:      500_000,
		AffCode:    "ch-invitee",
	}
	require.NoError(t, DB.Create(&invitee).Error)

	bonus, err := ClaimTelegramChannelBonus(invitee.TelegramId, "@VL_API", 250_000)
	require.NoError(t, err)
	var reward ReferralReward
	require.NoError(t, DB.Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTelegramSubscription, bonus.Id).First(&reward).Error)
	assert.Equal(t, ReferralRewardStatusPending, reward.Status)
	assert.Equal(t, 125_000, reward.RewardQuota)
	qualified, err := qualifiedReferralCount(DB, inviter.Id)
	require.NoError(t, err)
	assert.Zero(t, qualified)

	_, changed, err := RevokeTelegramChannelBonus(invitee.TelegramId, "@VL_API", time.Unix(bonus.CreatedAt, 0).Add(7*24*time.Hour), 30*24*time.Hour)
	require.NoError(t, err)
	assert.True(t, changed)
	require.NoError(t, DB.First(&reward, reward.Id).Error)
	assert.Equal(t, ReferralRewardStatusRevoked, reward.Status)
	qualified, err = qualifiedReferralCount(DB, inviter.Id)
	require.NoError(t, err)
	assert.Zero(t, qualified)
}

func TestTelegramReferralFailureRollsBackChannelBonusAndRetrySucceeds(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	common.QuotaForInviter = 125_000
	inviter := User{Username: "ledger-failure-inviter", Status: common.UserStatusEnabled, AffCode: "ledger-failure-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username:   "ledger-failure-invitee",
		Status:     common.UserStatusEnabled,
		TelegramId: "ledger-failure-telegram",
		InviterId:  inviter.Id,
		AffCode:    "ledger-failure-invitee",
		Quota:      100,
	}
	require.NoError(t, DB.Create(&invitee).Error)

	callbackName := "test:fail-referral-reward-create"
	callbackRegistered := true
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "referral_rewards" {
			tx.AddError(errors.New("referral ledger unavailable"))
		}
	}))
	t.Cleanup(func() {
		if callbackRegistered {
			require.NoError(t, DB.Callback().Create().Remove(callbackName))
		}
	})

	_, err := ClaimTelegramChannelBonus(invitee.TelegramId, "@VL_API", 250_000)
	require.ErrorContains(t, err, "referral ledger unavailable")
	var reloaded User
	require.NoError(t, DB.First(&reloaded, invitee.Id).Error)
	assert.Equal(t, 100, reloaded.Quota)
	var bonusCount int64
	require.NoError(t, DB.Model(&TelegramChannelBonus{}).Where("user_id = ?", invitee.Id).Count(&bonusCount).Error)
	assert.Zero(t, bonusCount)
	var rewardCount int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("invitee_id = ?", invitee.Id).Count(&rewardCount).Error)
	assert.Zero(t, rewardCount)

	require.NoError(t, DB.Callback().Create().Remove(callbackName))
	callbackRegistered = false
	bonus, err := ClaimTelegramChannelBonus(invitee.TelegramId, "@VL_API", 250_000)
	require.NoError(t, err)
	assert.NotZero(t, bonus.Id)
	require.NoError(t, DB.First(&reloaded, invitee.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)
	require.NoError(t, DB.Model(&ReferralReward{}).Where("source_id = ?", bonus.Id).Count(&rewardCount).Error)
	assert.EqualValues(t, 1, rewardCount)
}

func TestRepeatedTelegramCallbacksReconcileMissingLedgerRows(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	common.QuotaForInviter = 125_000

	inviter := User{Username: "ledger-reconcile-inviter", Status: common.UserStatusEnabled, AffCode: "ledger-reconcile-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	activeInvitee := User{
		Username:   "ledger-reconcile-active",
		Status:     common.UserStatusEnabled,
		TelegramId: "ledger-reconcile-active",
		InviterId:  inviter.Id,
		AffCode:    "ledger-reconcile-active",
		Quota:      250_100,
	}
	require.NoError(t, DB.Create(&activeInvitee).Error)
	activeBonus := TelegramChannelBonus{
		UserId: activeInvitee.Id, TelegramId: activeInvitee.TelegramId, Channel: "@VL_API",
		QuotaAwarded: 250_000, CreatedAt: time.Now().Add(-24 * time.Hour).Unix(),
	}
	require.NoError(t, DB.Create(&activeBonus).Error)

	bonus, err := ClaimTelegramChannelBonus(activeInvitee.TelegramId, "@VL_API", 250_000)
	require.ErrorIs(t, err, ErrTelegramChannelBonusAlreadyClaimed)
	assert.Equal(t, activeBonus.Id, bonus.Id)
	var reward ReferralReward
	require.NoError(t, DB.Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTelegramSubscription, activeBonus.Id).First(&reward).Error)
	assert.Equal(t, ReferralRewardStatusPending, reward.Status)
	var reloaded User
	require.NoError(t, DB.First(&reloaded, activeInvitee.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)

	revokedInvitee := User{
		Username:   "ledger-reconcile-revoked",
		Status:     common.UserStatusEnabled,
		TelegramId: "ledger-reconcile-revoked",
		InviterId:  inviter.Id,
		AffCode:    "ledger-reconcile-revoked",
		Quota:      100,
	}
	require.NoError(t, DB.Create(&revokedInvitee).Error)
	now := time.Now()
	revokedBonus := TelegramChannelBonus{
		UserId: revokedInvitee.Id, TelegramId: revokedInvitee.TelegramId, Channel: "@VL_API",
		QuotaAwarded: 250_000, CreatedAt: now.Add(-7 * 24 * time.Hour).Unix(),
		RevokedAt: now.Add(-time.Hour).Unix(), RevocationReason: "left_channel",
	}
	require.NoError(t, DB.Create(&revokedBonus).Error)

	bonus, changed, err := RevokeTelegramChannelBonus(revokedInvitee.TelegramId, "@VL_API", now, 30*24*time.Hour)
	require.NoError(t, err)
	assert.False(t, changed)
	assert.Equal(t, revokedBonus.Id, bonus.Id)
	reward = ReferralReward{}
	require.NoError(t, DB.Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTelegramSubscription, revokedBonus.Id).First(&reward).Error)
	assert.Equal(t, ReferralRewardStatusRevoked, reward.Status)
	reloaded = User{}
	require.NoError(t, DB.First(&reloaded, revokedInvitee.Id).Error)
	assert.Equal(t, 100, reloaded.Quota)
}

func TestTelegramReferralRevocationFailureRollsBackAndRetrySucceeds(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	common.QuotaForInviter = 125_000

	inviter := User{Username: "revoke-failure-inviter", Status: common.UserStatusEnabled, AffCode: "revoke-failure-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username: "revoke-failure-invitee", Status: common.UserStatusEnabled,
		TelegramId: "revoke-failure-telegram", InviterId: inviter.Id,
		AffCode: "revoke-failure-invitee", Quota: 100,
	}
	require.NoError(t, DB.Create(&invitee).Error)
	bonus, err := ClaimTelegramChannelBonus(invitee.TelegramId, "@VL_API", 250_000)
	require.NoError(t, err)

	callbackName := "test:fail-referral-reward-update"
	callbackRegistered := true
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "referral_rewards" {
			tx.AddError(errors.New("referral ledger unavailable"))
		}
	}))
	t.Cleanup(func() {
		if callbackRegistered {
			require.NoError(t, DB.Callback().Update().Remove(callbackName))
		}
	})

	now := time.Unix(bonus.CreatedAt, 0).Add(7 * 24 * time.Hour)
	_, changed, err := RevokeTelegramChannelBonus(invitee.TelegramId, "@VL_API", now, 30*24*time.Hour)
	require.ErrorContains(t, err, "referral ledger unavailable")
	assert.False(t, changed)
	var reloadedBonus TelegramChannelBonus
	require.NoError(t, DB.First(&reloadedBonus, bonus.Id).Error)
	assert.Zero(t, reloadedBonus.RevokedAt)
	var reward ReferralReward
	require.NoError(t, DB.Where("source_id = ?", bonus.Id).First(&reward).Error)
	assert.Equal(t, ReferralRewardStatusPending, reward.Status)
	var reloaded User
	require.NoError(t, DB.First(&reloaded, invitee.Id).Error)
	assert.Equal(t, 250_100, reloaded.Quota)

	require.NoError(t, DB.Callback().Update().Remove(callbackName))
	callbackRegistered = false
	_, changed, err = RevokeTelegramChannelBonus(invitee.TelegramId, "@VL_API", now, 30*24*time.Hour)
	require.NoError(t, err)
	assert.True(t, changed)
	require.NoError(t, DB.First(&reloadedBonus, bonus.Id).Error)
	assert.Equal(t, now.Unix(), reloadedBonus.RevokedAt)
	require.NoError(t, DB.First(&reward, reward.Id).Error)
	assert.Equal(t, ReferralRewardStatusRevoked, reward.Status)
	require.NoError(t, DB.First(&reloaded, invitee.Id).Error)
	assert.Equal(t, 100, reloaded.Quota)
}

func TestReferralOverviewSettlesMatureRewardExactlyOnce(t *testing.T) {
	truncateTables(t)
	inviter := User{Username: "overview-inviter", Status: common.UserStatusEnabled, AffCode: "overview-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{Username: "overview-invitee", Status: common.UserStatusEnabled, InviterId: inviter.Id, AffCode: "overview-invitee"}
	require.NoError(t, DB.Create(&invitee).Error)
	now := time.Now().Unix()
	require.NoError(t, DB.Create(&ReferralReward{
		InviterId:   inviter.Id,
		InviteeId:   invitee.Id,
		RewardType:  ReferralRewardTypeTelegramSubscription,
		SourceId:    991,
		RewardQuota: 125_000,
		Status:      ReferralRewardStatusPending,
		AvailableAt: now - 1,
		CreatedAt:   now - int64(telegramReferralQualificationWindow/time.Second),
	}).Error)

	overview, err := GetReferralOverview(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, "overview-inviter", overview.ReferralCode)
	assert.Equal(t, 1, overview.RegisteredCount)
	assert.Equal(t, 1, overview.QualifiedCount)
	assert.Equal(t, 125_000, overview.AvailableQuota)
	assert.Zero(t, overview.PendingQuota)
	assert.Equal(t, 125_000, overview.LifetimeQuota)
	assert.Equal(t, "starter", overview.Level.Code)

	overview, err = GetReferralOverview(inviter.Id)
	require.NoError(t, err)
	assert.Equal(t, 125_000, overview.AvailableQuota)
	assert.Equal(t, 125_000, overview.LifetimeQuota)
}

func TestTopUpReferralRewardIsIdempotentAndSkipsIneligibleRecipient(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	setting.ReferralTopUpRewardPercent = 5
	inviter := User{Username: "topup-referral-inviter", Status: common.UserStatusEnabled, AffCode: "topup-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{Username: "topup-referral-invitee", Status: common.UserStatusEnabled, InviterId: inviter.Id, AffCode: "topup-invitee"}
	require.NoError(t, DB.Create(&invitee).Error)

	for attempt := 0; attempt < 2; attempt++ {
		require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
			return CreateTopUpReferralRewardWithTx(tx, 501, invitee.Id, 10_000)
		}))
	}
	var reloaded User
	require.NoError(t, DB.First(&reloaded, inviter.Id).Error)
	assert.Equal(t, 500, reloaded.AffQuota)
	assert.Equal(t, 500, reloaded.AffHistoryQuota)
	var count int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTopUpCommission, 501).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Update("status", common.UserStatusDisabled).Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return CreateTopUpReferralRewardWithTx(tx, 502, invitee.Id, 10_000)
	}))
	require.NoError(t, DB.Model(&ReferralReward{}).Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTopUpCommission, 502).Count(&count).Error)
	assert.Zero(t, count)

	require.NoError(t, DB.Model(&User{}).Where("id = ?", inviter.Id).Updates(map[string]any{
		"status":      common.UserStatusEnabled,
		"aff_quota":   common.MaxWalletQuota,
		"aff_history": common.MaxWalletQuota,
	}).Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return CreateTopUpReferralRewardWithTx(tx, 503, invitee.Id, 10_000)
	}))
	require.NoError(t, DB.Model(&ReferralReward{}).Where("reward_type = ? AND source_id = ?", ReferralRewardTypeTopUpCommission, 503).Count(&count).Error)
	assert.Zero(t, count)
}

func TestTopUpReferralLedgerFailureRollsBackCreditAndRetrySucceeds(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	setting.ReferralTopUpRewardPercent = 5
	inviter := User{Username: "topup-atomic-inviter", Status: common.UserStatusEnabled, AffCode: "topup-atomic-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username: "topup-atomic-invitee", Status: common.UserStatusEnabled,
		InviterId: inviter.Id, AffCode: "topup-atomic-invitee", Quota: 100,
	}
	require.NoError(t, DB.Create(&invitee).Error)
	topUp := TopUp{UserId: invitee.Id, Amount: 1, TradeNo: "topup-atomic", Status: common.TopUpStatusPending}
	require.NoError(t, DB.Create(&topUp).Error)

	callbackName := "test:fail-topup-referral-reward-create"
	callbackRegistered := true
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		if tx.Statement.Table == "referral_rewards" {
			tx.AddError(errors.New("referral ledger unavailable"))
		}
	}))
	t.Cleanup(func() {
		if callbackRegistered {
			require.NoError(t, DB.Callback().Create().Remove(callbackName))
		}
	})

	err := DB.Transaction(func(tx *gorm.DB) error {
		return creditTopUpQuotaWithReferralReward(tx, &topUp, 10_000, nil)
	})
	require.ErrorContains(t, err, "referral ledger unavailable")
	var reloadedInvitee User
	require.NoError(t, DB.First(&reloadedInvitee, invitee.Id).Error)
	assert.Equal(t, 100, reloadedInvitee.Quota)
	var reloadedInviter User
	require.NoError(t, DB.First(&reloadedInviter, inviter.Id).Error)
	assert.Zero(t, reloadedInviter.AffQuota)
	var rewardCount int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("source_id = ?", topUp.Id).Count(&rewardCount).Error)
	assert.Zero(t, rewardCount)

	require.NoError(t, DB.Callback().Create().Remove(callbackName))
	callbackRegistered = false
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return creditTopUpQuotaWithReferralReward(tx, &topUp, 10_000, nil)
	}))
	require.NoError(t, DB.First(&reloadedInvitee, invitee.Id).Error)
	assert.Equal(t, 10_100, reloadedInvitee.Quota)
	require.NoError(t, DB.First(&reloadedInviter, inviter.Id).Error)
	assert.Equal(t, 500, reloadedInviter.AffQuota)
	require.NoError(t, DB.Model(&ReferralReward{}).Where("source_id = ?", topUp.Id).Count(&rewardCount).Error)
	assert.EqualValues(t, 1, rewardCount)
}

func TestRepeatedHistoricalTopUpCallbackDoesNotCreateReferralReward(t *testing.T) {
	truncateTables(t)
	enableReferralRewardsForTest(t)
	setting.ReferralTopUpRewardPercent = 5
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	common.QuotaPerUnit = 10_000

	inviter := User{Username: "topup-reconcile-inviter", Status: common.UserStatusEnabled, AffCode: "topup-reconcile-inviter"}
	require.NoError(t, DB.Create(&inviter).Error)
	invitee := User{
		Username: "topup-reconcile-invitee", Status: common.UserStatusEnabled,
		InviterId: inviter.Id, AffCode: "topup-reconcile-invitee", Quota: 10_100,
	}
	require.NoError(t, DB.Create(&invitee).Error)
	topUp := TopUp{
		UserId: invitee.Id, Amount: 1, Money: 1, TradeNo: "topup-reconcile",
		PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(&topUp).Error)

	alreadyDone, err := RechargeEpay(topUp.TradeNo, "", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	var rewardCount int64
	require.NoError(t, DB.Model(&ReferralReward{}).Where("source_id = ?", topUp.Id).Count(&rewardCount).Error)
	assert.Zero(t, rewardCount)
	var reloadedInviter User
	require.NoError(t, DB.First(&reloadedInviter, inviter.Id).Error)
	assert.Zero(t, reloadedInviter.AffQuota)
	var reloadedInvitee User
	require.NoError(t, DB.First(&reloadedInvitee, invitee.Id).Error)
	assert.Equal(t, 10_100, reloadedInvitee.Quota)

	alreadyDone, err = RechargeEpay(topUp.TradeNo, "", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	require.NoError(t, DB.First(&reloadedInviter, inviter.Id).Error)
	assert.Zero(t, reloadedInviter.AffQuota)
}

func TestTransferAffQuotaRejectsWalletOverflow(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	common.QuotaPerUnit = 1
	user := User{
		Username: "referral-transfer-overflow",
		Status:   common.UserStatusEnabled,
		Quota:    common.MaxWalletQuota - 5,
		AffQuota: 10,
	}
	require.NoError(t, DB.Create(&user).Error)

	err := user.TransferAffQuotaToQuota(10)
	require.Error(t, err)
	var reloaded User
	require.NoError(t, DB.First(&reloaded, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota-5, reloaded.Quota)
	assert.Equal(t, 10, reloaded.AffQuota)
}
