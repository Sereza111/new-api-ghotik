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
package model

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const ResellerSubscriptionStatusActive = "active"

var (
	ErrResellerSubscriptionAlreadyActive      = errors.New("reseller subscription is already active")
	ErrResellerSubscriptionRequired           = errors.New("an active reseller subscription is required")
	ErrResellerSubscriptionWalletInsufficient = errors.New("insufficient balance to purchase reseller subscription")
	ErrResellerTokenLimitReached              = errors.New("maximum API key limit reached")
)

// ResellerSubscription is an entitlement ledger, not an API quota plan.
// Price fields use decimal text so purchase-time values round-trip identically
// through SQLite, MySQL, and PostgreSQL.
type ResellerSubscription struct {
	Id              int    `json:"id"`
	UserId          int    `json:"user_id" gorm:"index;uniqueIndex:idx_reseller_subscription_request,priority:1;index:idx_reseller_subscription_active,priority:1"`
	Status          string `json:"status" gorm:"type:varchar(16);index:idx_reseller_subscription_active,priority:2"`
	StartTime       int64  `json:"start_time" gorm:"bigint"`
	EndTime         int64  `json:"end_time" gorm:"bigint;index:idx_reseller_subscription_active,priority:3"`
	ListPrice       string `json:"list_price" gorm:"type:varchar(64)"`
	DiscountPercent int    `json:"discount_percent"`
	PaidPrice       string `json:"paid_price" gorm:"type:varchar(64)"`
	ChargedQuota    int    `json:"charged_quota"`
	DurationDays    int    `json:"duration_days"`
	RequestId       string `json:"-" gorm:"type:varchar(128);uniqueIndex:idx_reseller_subscription_request,priority:2"`
	CreatedTime     int64  `json:"created_time" gorm:"bigint"`
}

type ResellerSubscriptionPurchase struct {
	UserId          int
	ListPrice       string
	DiscountPercent int
	PaidPrice       string
	ChargedQuota    int
	DurationDays    int
	RequestId       string
}

func (subscription *ResellerSubscription) IsActiveAt(now int64) bool {
	return subscription != nil && subscription.Status == ResellerSubscriptionStatusActive &&
		subscription.StartTime <= now && subscription.EndTime > now
}

func GetActiveResellerSubscription(userId int) (*ResellerSubscription, error) {
	return getActiveResellerSubscriptionAt(DB, userId, common.GetTimestamp())
}

func GetResellerSubscriptionByRequestID(userId int, requestID string) (*ResellerSubscription, error) {
	return getResellerSubscriptionByRequestID(DB, userId, requestID)
}

func getResellerSubscriptionByRequestID(db *gorm.DB, userId int, requestID string) (*ResellerSubscription, error) {
	var subscription ResellerSubscription
	err := db.Where("user_id = ? AND request_id = ?", userId, requestID).First(&subscription).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &subscription, nil
}

func getActiveResellerSubscriptionAt(db *gorm.DB, userId int, now int64) (*ResellerSubscription, error) {
	var subscription ResellerSubscription
	err := db.Where(
		"user_id = ? AND status = ? AND start_time <= ? AND end_time > ?",
		userId, ResellerSubscriptionStatusActive, now, now,
	).Order("end_time desc").First(&subscription).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &subscription, nil
}

// PurchaseResellerSubscription atomically charges the user's wallet and
// records the entitlement. Replaying a request ID returns the original row
// without charging again, even after that entitlement has expired.
func PurchaseResellerSubscription(purchase ResellerSubscriptionPurchase) (bool, *ResellerSubscription, error) {
	if purchase.UserId <= 0 || purchase.RequestId == "" || utf8.RuneCountInString(purchase.RequestId) > 128 ||
		purchase.RequestId != strings.TrimSpace(purchase.RequestId) || strings.IndexFunc(purchase.RequestId, unicode.IsControl) >= 0 {
		return false, nil, errors.New("invalid reseller subscription purchase")
	}
	if purchase.DiscountPercent < 0 || purchase.DiscountPercent > operation_setting.ResellerSubscriptionMaxDiscountPercent ||
		purchase.DurationDays < operation_setting.ResellerSubscriptionMinDurationDays ||
		purchase.DurationDays > operation_setting.ResellerSubscriptionMaxDurationDays {
		return false, nil, errors.New("invalid reseller subscription terms")
	}
	listPrice, err := decimal.NewFromString(purchase.ListPrice)
	if err != nil || listPrice.LessThan(decimal.NewFromFloat(operation_setting.ResellerSubscriptionMinPrice)) ||
		listPrice.GreaterThan(decimal.NewFromInt(operation_setting.ResellerSubscriptionMaxPrice)) || listPrice.Exponent() < -2 {
		return false, nil, errors.New("invalid reseller subscription list price")
	}
	paidPrice, err := decimal.NewFromString(purchase.PaidPrice)
	if err != nil || paidPrice.Exponent() < -2 {
		return false, nil, errors.New("invalid reseller subscription paid price")
	}
	expectedPaidPrice := listPrice.
		Mul(decimal.NewFromInt(int64(100 - purchase.DiscountPercent))).
		Div(decimal.NewFromInt(100)).
		Round(2)
	minimumPrice := decimal.NewFromFloat(operation_setting.ResellerSubscriptionMinPrice)
	if expectedPaidPrice.LessThan(minimumPrice) {
		expectedPaidPrice = minimumPrice
	}
	if !paidPrice.Equal(expectedPaidPrice) {
		return false, nil, errors.New("reseller subscription paid price does not match its terms")
	}
	expectedQuota, err := common.WalletQuotaFromDecimalStrict(paidPrice.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || expectedQuota <= 0 || purchase.ChargedQuota != expectedQuota {
		return false, nil, errors.New("invalid reseller subscription wallet charge")
	}

	now := common.GetTimestamp()
	created := false
	var result *ResellerSubscription
	err = DB.Transaction(func(tx *gorm.DB) error {
		var owner User
		if err := lockForUpdate(tx).Where("id = ?", purchase.UserId).First(&owner).Error; err != nil {
			return err
		}

		existing, lookupErr := getResellerSubscriptionByRequestID(tx, purchase.UserId, purchase.RequestId)
		if lookupErr != nil {
			return lookupErr
		}
		if existing != nil {
			result = existing
			return nil
		}

		active, err := getActiveResellerSubscriptionAt(tx, purchase.UserId, now)
		if err != nil {
			return err
		}
		if active != nil {
			return ErrResellerSubscriptionAlreadyActive
		}

		walletResult := tx.Model(&User{}).
			Where("id = ? AND quota >= ?", purchase.UserId, purchase.ChargedQuota).
			Update("quota", gorm.Expr("quota - ?", purchase.ChargedQuota))
		if walletResult.Error != nil {
			return walletResult.Error
		}
		if walletResult.RowsAffected != 1 {
			return ErrResellerSubscriptionWalletInsufficient
		}

		subscription := ResellerSubscription{
			UserId:          purchase.UserId,
			Status:          ResellerSubscriptionStatusActive,
			StartTime:       now,
			EndTime:         now + int64(purchase.DurationDays)*24*60*60,
			ListPrice:       listPrice.StringFixed(2),
			DiscountPercent: purchase.DiscountPercent,
			PaidPrice:       paidPrice.StringFixed(2),
			ChargedQuota:    purchase.ChargedQuota,
			DurationDays:    purchase.DurationDays,
			RequestId:       purchase.RequestId,
			CreatedTime:     now,
		}
		if err := tx.Create(&subscription).Error; err != nil {
			return err
		}
		created = true
		result = &subscription
		return nil
	})
	if err != nil {
		return false, nil, err
	}
	if created {
		if cacheErr := invalidateUserCache(purchase.UserId); cacheErr != nil {
			common.SysLog("failed to invalidate user quota cache after reseller subscription purchase: " + cacheErr.Error())
		}
	}
	return created, result, nil
}
