package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrTelegramChannelBonusAlreadyClaimed = errors.New("telegram channel bonus already claimed")
	ErrTelegramChannelBonusUserNotFound   = errors.New("telegram account is not linked")
	ErrTelegramChannelBonusUserDisabled   = errors.New("user is disabled")
)

type TelegramChannelBonus struct {
	Id               int    `json:"id" gorm:"primaryKey"`
	UserId           int    `json:"user_id" gorm:"not null;uniqueIndex"`
	TelegramId       string `json:"telegram_id" gorm:"type:varchar(32);not null;uniqueIndex"`
	Channel          string `json:"channel" gorm:"type:varchar(128);not null"`
	QuotaAwarded     int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;not null"`
	RevokedAt        int64  `json:"revoked_at" gorm:"bigint;not null;default:0"`
	RevocationReason string `json:"revocation_reason" gorm:"type:varchar(64)"`
}

func GetTelegramChannelBonusByTelegramId(telegramId string) (*TelegramChannelBonus, error) {
	telegramId = strings.TrimSpace(telegramId)
	if telegramId == "" {
		return nil, errors.New("invalid telegram id")
	}
	bonus := &TelegramChannelBonus{}
	if err := DB.Where("telegram_id = ?", telegramId).First(bonus).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return bonus, nil
}

func (TelegramChannelBonus) TableName() string {
	return "telegram_channel_bonuses"
}

func ClaimTelegramChannelBonus(telegramId string, channel string, quota int) (*TelegramChannelBonus, error) {
	telegramId = strings.TrimSpace(telegramId)
	channel = strings.TrimSpace(channel)
	if telegramId == "" || channel == "" || quota <= 0 {
		return nil, errors.New("invalid telegram channel bonus claim")
	}

	bonus := &TelegramChannelBonus{}
	userId := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("telegram_id = ?", telegramId).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTelegramChannelBonusUserNotFound
			}
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return ErrTelegramChannelBonusUserDisabled
		}

		var existing int64
		if err := tx.Model(&TelegramChannelBonus{}).
			Where("user_id = ? OR telegram_id = ?", user.Id, telegramId).
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return ErrTelegramChannelBonusAlreadyClaimed
		}

		*bonus = TelegramChannelBonus{
			UserId:       user.Id,
			TelegramId:   telegramId,
			Channel:      channel,
			QuotaAwarded: quota,
			CreatedAt:    time.Now().Unix(),
		}
		if err := tx.Create(bonus).Error; err != nil {
			return err
		}

		result := tx.Model(&User{}).
			Where("id = ? AND status = ?", user.Id, common.UserStatusEnabled).
			Update("quota", gorm.Expr("quota + ?", quota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTelegramChannelBonusUserDisabled
		}
		userId = user.Id
		return nil
	})
	if err != nil {
		return nil, err
	}

	syncCreditUserQuotaCache(userId, quota, "telegram channel bonus")
	return bonus, nil
}

func RevokeTelegramChannelBonus(
	telegramId string,
	channel string,
	now time.Time,
	revocationWindow time.Duration,
) (*TelegramChannelBonus, bool, error) {
	telegramId = strings.TrimSpace(telegramId)
	channel = strings.TrimSpace(channel)
	if telegramId == "" || channel == "" || now.IsZero() || revocationWindow <= 0 {
		return nil, false, errors.New("invalid telegram channel bonus revocation")
	}

	bonus := &TelegramChannelBonus{}
	userId := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Where("telegram_id = ?", telegramId).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		cutoff := now.Add(-revocationWindow).Unix()
		if err := lockForUpdate(tx).
			Where("user_id = ? AND channel = ? AND revoked_at = ? AND created_at BETWEEN ? AND ?", user.Id, channel, 0, cutoff, now.Unix()).
			First(bonus).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}

		result := tx.Model(&TelegramChannelBonus{}).
			Where("id = ? AND revoked_at = ?", bonus.Id, 0).
			Updates(map[string]any{
				"revoked_at":        now.Unix(),
				"revocation_reason": "left_channel",
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}

		if err := tx.Model(&User{}).
			Where("id = ?", user.Id).
			Update("quota", gorm.Expr("quota - ?", bonus.QuotaAwarded)).Error; err != nil {
			return err
		}
		bonus.RevokedAt = now.Unix()
		bonus.RevocationReason = "left_channel"
		userId = user.Id
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if userId == 0 {
		return bonus, false, nil
	}

	if err := cacheDecrUserQuota(userId, int64(bonus.QuotaAwarded)); err != nil {
		common.SysLog("failed to sync telegram channel bonus revocation to user quota cache: " + err.Error())
		if invalidateErr := invalidateUserCache(userId); invalidateErr != nil {
			common.SysLog("failed to invalidate user cache after telegram channel bonus revocation: " + invalidateErr.Error())
		}
	}
	return bonus, true, nil
}
