package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ReferralRewardTypeTelegramSubscription = "telegram_subscription"
	ReferralRewardTypeTopUpCommission      = "topup_commission"

	ReferralRewardStatusPending   = "pending"
	ReferralRewardStatusAvailable = "available"
	ReferralRewardStatusRevoked   = "revoked"

	telegramReferralQualificationWindow = 30 * 24 * time.Hour
)

// ReferralReward is the durable source ledger for referral earnings. The
// reward type and source id pair makes webhook retries and repeated Telegram
// updates idempotent across every supported database.
type ReferralReward struct {
	Id               int    `json:"id" gorm:"primaryKey"`
	InviterId        int    `json:"inviter_id" gorm:"not null;index"`
	InviteeId        int    `json:"invitee_id" gorm:"not null;index"`
	RewardType       string `json:"reward_type" gorm:"type:varchar(32);not null;uniqueIndex:idx_referral_reward_source,priority:1"`
	SourceId         int    `json:"source_id" gorm:"not null;uniqueIndex:idx_referral_reward_source,priority:2"`
	BasisQuota       int    `json:"basis_quota" gorm:"type:bigint;not null"`
	RateBps          int    `json:"rate_bps" gorm:"not null"`
	RewardQuota      int    `json:"reward_quota" gorm:"type:bigint;not null"`
	Status           string `json:"status" gorm:"type:varchar(16);not null;index"`
	AvailableAt      int64  `json:"available_at" gorm:"type:bigint;not null;index"`
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;not null"`
	SettledAt        int64  `json:"settled_at" gorm:"type:bigint;not null;default:0"`
	RevokedAt        int64  `json:"revoked_at" gorm:"type:bigint;not null;default:0"`
	RevocationReason string `json:"revocation_reason" gorm:"type:varchar(64)"`
}

func (ReferralReward) TableName() string {
	return "referral_rewards"
}

type ReferralLevel struct {
	Code                    string  `json:"code"`
	Name                    string  `json:"name"`
	CurrentThreshold        int     `json:"current_threshold"`
	NextThreshold           *int    `json:"next_threshold"`
	ProgressPercent         float64 `json:"progress_percent"`
	TopUpFeeDiscountPercent float64 `json:"topup_fee_discount_percent"`
}

type referralLevelDefinition struct {
	code      string
	name      string
	threshold int
	discount  float64
}

var referralLevelDefinitions = []referralLevelDefinition{
	{code: "starter", name: "Starter", threshold: 0, discount: 0},
	{code: "bronze", name: "Bronze", threshold: 5, discount: 1},
	{code: "silver", name: "Silver", threshold: 20, discount: 2},
	{code: "gold", name: "Gold", threshold: 50, discount: 3},
}

func ResolveReferralLevel(qualifiedCount int) ReferralLevel {
	if qualifiedCount < 0 {
		qualifiedCount = 0
	}
	currentIndex := 0
	for index, definition := range referralLevelDefinitions {
		if qualifiedCount < definition.threshold {
			break
		}
		currentIndex = index
	}

	current := referralLevelDefinitions[currentIndex]
	level := ReferralLevel{
		Code:                    current.code,
		Name:                    current.name,
		CurrentThreshold:        current.threshold,
		ProgressPercent:         100,
		TopUpFeeDiscountPercent: current.discount,
	}
	if currentIndex == len(referralLevelDefinitions)-1 {
		return level
	}

	next := referralLevelDefinitions[currentIndex+1].threshold
	level.NextThreshold = &next
	level.ProgressPercent = float64(qualifiedCount-current.threshold) * 100 / float64(next-current.threshold)
	if level.ProgressPercent < 0 {
		level.ProgressPercent = 0
	}
	if level.ProgressPercent > 100 {
		level.ProgressPercent = 100
	}
	return level
}

func qualifiedReferralCount(query *gorm.DB, inviterId int) (int, error) {
	var count int64
	err := query.Model(&ReferralReward{}).
		Where("inviter_id = ? AND reward_type = ? AND status = ?", inviterId, ReferralRewardTypeTelegramSubscription, ReferralRewardStatusAvailable).
		Count(&count).Error
	return int(count), err
}

func GetUserReferralLevel(userId int) (ReferralLevel, error) {
	if err := settleMatureReferralRewards(userId, time.Now().Unix()); err != nil {
		return ReferralLevel{}, err
	}
	count, err := qualifiedReferralCount(DB, userId)
	if err != nil {
		return ReferralLevel{}, err
	}
	return ResolveReferralLevel(count), nil
}

func createTelegramReferralRewardWithTx(tx *gorm.DB, user *User, bonus *TelegramChannelBonus) error {
	if user.InviterId <= 0 {
		return nil
	}
	if user.InviterId == user.Id {
		return errors.New("self referral is not allowed")
	}

	var inviter User
	if err := tx.Select("id", "status").Where("id = ?", user.InviterId).First(&inviter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if inviter.Status != common.UserStatusEnabled {
		return nil
	}

	rewardQuota := common.QuotaForInviter
	if !operation_setting.IsPaymentComplianceConfirmed() {
		rewardQuota = 0
	}
	if rewardQuota < 0 || rewardQuota > common.MaxWalletQuota {
		return errors.New("invalid Telegram referral reward quota")
	}

	createdAt := bonus.CreatedAt
	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "reward_type"}, {Name: "source_id"}},
		DoNothing: true,
	}).Create(&ReferralReward{
		InviterId:   user.InviterId,
		InviteeId:   user.Id,
		RewardType:  ReferralRewardTypeTelegramSubscription,
		SourceId:    bonus.Id,
		RewardQuota: rewardQuota,
		Status:      ReferralRewardStatusPending,
		AvailableAt: time.Unix(createdAt, 0).Add(telegramReferralQualificationWindow).Unix(),
		CreatedAt:   createdAt,
	}).Error
}

func revokeTelegramReferralRewardWithTx(tx *gorm.DB, bonusId int, now int64, reason string) error {
	return tx.Model(&ReferralReward{}).
		Where("reward_type = ? AND source_id = ? AND status = ?", ReferralRewardTypeTelegramSubscription, bonusId, ReferralRewardStatusPending).
		Updates(map[string]any{
			"status":            ReferralRewardStatusRevoked,
			"revoked_at":        now,
			"revocation_reason": strings.TrimSpace(reason),
		}).Error
}

// reconcileTelegramReferralRewardWithTx repairs the durable ledger for
// callbacks that were previously acknowledged while ledger writes were
// best-effort. The source unique index keeps repeated callbacks idempotent.
func reconcileTelegramReferralRewardWithTx(tx *gorm.DB, user *User, bonus *TelegramChannelBonus) error {
	if err := createTelegramReferralRewardWithTx(tx, user, bonus); err != nil {
		return err
	}
	if bonus.RevokedAt == 0 {
		return nil
	}
	reason := strings.TrimSpace(bonus.RevocationReason)
	if reason == "" {
		reason = "left_channel"
	}
	return revokeTelegramReferralRewardWithTx(tx, bonus.Id, bonus.RevokedAt, reason)
}

// CreateTopUpReferralRewardWithTx records and credits the inviter's commission
// inside the same transaction as the successful balance top-up. Callers must
// pass a locked top-up source and invoke this helper at most once per source.
func CreateTopUpReferralRewardWithTx(tx *gorm.DB, topUpId int, inviteeId int, basisQuota int) error {
	if topUpId <= 0 || inviteeId <= 0 || basisQuota <= 0 || setting.ReferralTopUpRewardPercent <= 0 || !operation_setting.IsPaymentComplianceConfirmed() {
		return nil
	}

	var invitee User
	if err := tx.Select("id", "inviter_id").First(&invitee, inviteeId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if invitee.InviterId <= 0 || invitee.InviterId == invitee.Id {
		return nil
	}

	rateBps64 := decimal.NewFromFloat(setting.ReferralTopUpRewardPercent).Mul(decimal.NewFromInt(100)).Round(0).IntPart()
	if rateBps64 <= 0 || rateBps64 > 10000 {
		common.SysError("invalid referral top-up reward percent; referral reward skipped")
		return nil
	}
	rateBps := int(rateBps64)
	rewardQuota, err := common.WalletQuotaFromDecimalStrict(
		decimal.NewFromInt(int64(basisQuota)).Mul(decimal.NewFromInt(int64(rateBps))).Div(decimal.NewFromInt(10000)),
	)
	if err != nil {
		common.SysError(common.LogText("referral reward quota is invalid; reward skipped: %v", err))
		return nil
	}
	if rewardQuota <= 0 {
		return nil
	}

	var inviter User
	if err := lockForUpdate(tx).Select("id", "status", "aff_quota", "aff_history").First(&inviter, invitee.InviterId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if inviter.Status != common.UserStatusEnabled {
		return nil
	}
	if inviter.AffQuota > common.MaxWalletQuota-rewardQuota || inviter.AffHistoryQuota > common.MaxWalletQuota-rewardQuota {
		common.SysError(common.LogText("referral reward balance limit reached for inviter %d; reward skipped", inviter.Id))
		return nil
	}

	now := time.Now().Unix()
	reward := ReferralReward{
		InviterId:   invitee.InviterId,
		InviteeId:   invitee.Id,
		RewardType:  ReferralRewardTypeTopUpCommission,
		SourceId:    topUpId,
		BasisQuota:  basisQuota,
		RateBps:     rateBps,
		RewardQuota: rewardQuota,
		Status:      ReferralRewardStatusAvailable,
		AvailableAt: now,
		CreatedAt:   now,
		SettledAt:   now,
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "reward_type"}, {Name: "source_id"}},
		DoNothing: true,
	}).Create(&reward)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}

	result = tx.Model(&User{}).
		Where("id = ?", inviter.Id).
		Updates(map[string]any{
			"aff_quota":   inviter.AffQuota + rewardQuota,
			"aff_history": inviter.AffHistoryQuota + rewardQuota,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func settleMatureReferralRewards(inviterId int, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var pendingCount int64
		if err := tx.Model(&ReferralReward{}).
			Where("inviter_id = ? AND status = ? AND available_at <= ?", inviterId, ReferralRewardStatusPending, now).
			Count(&pendingCount).Error; err != nil {
			return err
		}
		if pendingCount == 0 {
			return nil
		}

		// Keep the same lock order as top-up settlement: inviter first, then
		// reward rows. This prevents a reward/top-up deadlock on MySQL and
		// PostgreSQL when both paths run for the same inviter.
		var inviter User
		if err := lockForUpdate(tx).First(&inviter, inviterId).Error; err != nil {
			return err
		}
		var rewards []ReferralReward
		if err := lockForUpdate(tx).
			Where("inviter_id = ? AND status = ? AND available_at <= ?", inviterId, ReferralRewardStatusPending, now).
			Order("id asc").
			Find(&rewards).Error; err != nil {
			return err
		}
		if len(rewards) == 0 {
			return nil
		}
		for _, reward := range rewards {
			if reward.RewardQuota < 0 || inviter.AffQuota > common.MaxWalletQuota-reward.RewardQuota || inviter.AffHistoryQuota > common.MaxWalletQuota-reward.RewardQuota {
				if err := tx.Model(&ReferralReward{}).
					Where("id = ? AND status = ?", reward.Id, ReferralRewardStatusPending).
					Updates(map[string]any{
						"status":            ReferralRewardStatusRevoked,
						"revoked_at":        now,
						"revocation_reason": "wallet_limit",
					}).Error; err != nil {
					return err
				}
				continue
			}
			result := tx.Model(&ReferralReward{}).
				Where("id = ? AND status = ?", reward.Id, ReferralRewardStatusPending).
				Updates(map[string]any{"status": ReferralRewardStatusAvailable, "settled_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				continue
			}
			if reward.RewardQuota == 0 {
				continue
			}
			inviter.AffQuota += reward.RewardQuota
			inviter.AffHistoryQuota += reward.RewardQuota
		}
		return tx.Model(&User{}).Where("id = ?", inviter.Id).Updates(map[string]any{
			"aff_quota":   inviter.AffQuota,
			"aff_history": inviter.AffHistoryQuota,
		}).Error
	})
}

type ReferralOverview struct {
	ReferralCode       string        `json:"referral_code"`
	RegisteredCount    int           `json:"registered_count"`
	QualifiedCount     int           `json:"qualified_count"`
	AvailableQuota     int           `json:"available_quota"`
	PendingQuota       int           `json:"pending_quota"`
	LifetimeQuota      int           `json:"lifetime_quota"`
	ChannelRewardQuota int           `json:"channel_reward_quota"`
	TopUpRewardPercent float64       `json:"topup_reward_percent"`
	Level              ReferralLevel `json:"level"`
}

func GetReferralOverview(userId int) (*ReferralOverview, error) {
	if err := settleMatureReferralRewards(userId, time.Now().Unix()); err != nil {
		return nil, err
	}

	var user User
	if err := DB.Select("id", "aff_code", "aff_quota", "aff_history").First(&user, userId).Error; err != nil {
		return nil, err
	}
	var registered int64
	if err := DB.Model(&User{}).Where("inviter_id = ?", userId).Count(&registered).Error; err != nil {
		return nil, err
	}
	qualified, err := qualifiedReferralCount(DB, userId)
	if err != nil {
		return nil, err
	}
	var pending int64
	if err := DB.Model(&ReferralReward{}).
		Where("inviter_id = ? AND status = ?", userId, ReferralRewardStatusPending).
		Select("COALESCE(SUM(reward_quota), 0)").Scan(&pending).Error; err != nil {
		return nil, err
	}
	if pending < 0 || pending > int64(common.MaxWalletQuota) {
		return nil, errors.New("pending referral reward quota exceeds wallet limits")
	}

	return &ReferralOverview{
		ReferralCode:       user.AffCode,
		RegisteredCount:    int(registered),
		QualifiedCount:     qualified,
		AvailableQuota:     user.AffQuota,
		PendingQuota:       int(pending),
		LifetimeQuota:      user.AffHistoryQuota,
		ChannelRewardQuota: common.QuotaForInviter,
		TopUpRewardPercent: setting.ReferralTopUpRewardPercent,
		Level:              ResolveReferralLevel(qualified),
	}, nil
}

type ReferralRewardListItem struct {
	Id          int    `json:"id"`
	RewardType  string `json:"reward_type"`
	RewardQuota int    `json:"reward_quota"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"created_at"`
	AvailableAt int64  `json:"available_at"`
	InviteeName string `json:"invitee_name"`
}

func maskReferralInviteeName(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) == 0 {
		return "***"
	}
	if len(runes) == 1 {
		return string(runes[0]) + "***"
	}
	return string(runes[:2]) + "***"
}

func ListReferralRewards(inviterId int, offset int, limit int) ([]ReferralRewardListItem, int, error) {
	if err := settleMatureReferralRewards(inviterId, time.Now().Unix()); err != nil {
		return nil, 0, err
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	type rewardRow struct {
		ReferralReward
		InviteeName string `gorm:"column:invitee_name"`
	}
	var total int64
	if err := DB.Model(&ReferralReward{}).Where("inviter_id = ?", inviterId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []rewardRow
	if err := DB.Model(&ReferralReward{}).
		Where("referral_rewards.inviter_id = ?", inviterId).
		Select("referral_rewards.*, users.username AS invitee_name").
		Joins("LEFT JOIN users ON users.id = referral_rewards.invitee_id").
		Order("referral_rewards.id desc").
		Offset(offset).Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]ReferralRewardListItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, ReferralRewardListItem{
			Id:          row.Id,
			RewardType:  row.RewardType,
			RewardQuota: row.RewardQuota,
			Status:      row.Status,
			CreatedAt:   row.CreatedAt,
			AvailableAt: row.AvailableAt,
			InviteeName: maskReferralInviteeName(row.InviteeName),
		})
	}
	return items, int(total), nil
}
