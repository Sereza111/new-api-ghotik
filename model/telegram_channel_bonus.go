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
	Id           int    `json:"id" gorm:"primaryKey"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex"`
	TelegramId   string `json:"telegram_id" gorm:"type:varchar(32);not null;uniqueIndex"`
	Channel      string `json:"channel" gorm:"type:varchar(128);not null"`
	QuotaAwarded int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;not null"`
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
