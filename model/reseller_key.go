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
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrResellerTokenDeletionNotAllowed = errors.New("reseller keys cannot be deleted; disable the key instead")
	ErrResellerTokenSecretUnavailable  = errors.New("reseller key secrets cannot be bulk exported")
	ErrResellerTokenQuotaInsufficient  = errors.New("reseller key quota is insufficient")
	errResellerWalletInsufficient      = errors.New("reseller wallet quota is insufficient")
)

// ResellerKey stores immutable commercial terms separately from the token
// secret. BaseCostPerMillion is decimal text so its purchase-time value is
// preserved identically by SQLite, MySQL, and PostgreSQL.
type ResellerKey struct {
	Id                 int    `json:"id"`
	TokenId            int    `json:"token_id" gorm:"uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"index;uniqueIndex:idx_reseller_user_request,priority:1"`
	TokenMillions      int    `json:"token_millions"`
	MarkupPercent      int    `json:"markup_percent"`
	BaseCostPerMillion string `json:"base_cost_per_million" gorm:"type:varchar(64)"`
	Endpoint           string `json:"endpoint" gorm:"type:varchar(512)"`
	CreatedTime        int64  `json:"created_time" gorm:"bigint"`
	// RequestId is nullable so legacy rows (created before idempotent issuance)
	// can coexist under the composite uniqueness index.  New purchases set it
	// to the client-provided idempotency key.
	RequestId *string `json:"-" gorm:"type:varchar(128);uniqueIndex:idx_reseller_user_request,priority:2"`
}

type ResellerKeyWithToken struct {
	Metadata ResellerKey
	Token    Token
}

// ResellerQuotaOperation makes request settlement and refund adjustments
// idempotent. The token mutation and operation marker are committed in one
// transaction, so retrying after an ambiguous database response cannot apply
// the same prepaid adjustment twice.
type ResellerQuotaOperation struct {
	Id          int    `json:"id"`
	OperationId string `json:"operation_id" gorm:"type:varchar(128);uniqueIndex"`
	TokenId     int    `json:"token_id" gorm:"index"`
	UserId      int    `json:"user_id" gorm:"index"`
	Adjustment  int    `json:"adjustment"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
}

func IsResellerTokenKey(key string) bool {
	key = strings.TrimPrefix(key, "sk-")
	if strings.HasPrefix(key, resellerTokenKeyPrefix+"_") {
		return true
	}
	// Keys created by the short-lived preview implementation remain prepaid.
	for _, markup := range []string{"20", "50", "80", "100"} {
		if strings.HasPrefix(key, resellerTokenKeyPrefix+markup+"_") {
			return true
		}
	}
	return false
}

func GetAllUserResellerKeys(userId int) ([]ResellerKeyWithToken, error) {
	var metadata []ResellerKey
	if err := DB.Where("user_id = ?", userId).Order("id desc").Find(&metadata).Error; err != nil {
		return nil, err
	}
	if len(metadata) == 0 {
		return []ResellerKeyWithToken{}, nil
	}

	tokenIds := make([]int, 0, len(metadata))
	for _, item := range metadata {
		tokenIds = append(tokenIds, item.TokenId)
	}
	var tokens []Token
	if err := DB.Where("user_id = ? AND id IN (?)", userId, tokenIds).Find(&tokens).Error; err != nil {
		return nil, err
	}
	tokensById := make(map[int]Token, len(tokens))
	for _, token := range tokens {
		tokensById[token.Id] = token
	}

	result := make([]ResellerKeyWithToken, 0, len(metadata))
	for _, item := range metadata {
		token, ok := tokensById[item.TokenId]
		if !ok {
			return nil, fmt.Errorf("reseller key metadata references missing token %d: %w", item.TokenId, gorm.ErrRecordNotFound)
		}
		if !IsResellerTokenKey(token.Key) {
			return nil, fmt.Errorf("reseller key metadata references non-reseller token %d", item.TokenId)
		}
		result = append(result, ResellerKeyWithToken{Metadata: item, Token: token})
	}
	return result, nil
}

// CreatePrepaidResellerToken commits the wallet debit, token, and immutable
// reseller metadata as one database transaction. User wallet writes are
// synchronous even in batch mode, so SQL is the sole purchase authority.
func CreatePrepaidResellerToken(token *Token, metadata *ResellerKey, walletQuota int) (bool, error) {
	created, _, err := CreatePrepaidResellerTokenWithRequestID(token, metadata, walletQuota, "")
	return created, err
}

// CreatePrepaidResellerTokenWithRequestID atomically issues a prepaid key and
// optionally makes the operation idempotent.  When requestID is repeated for
// the same owner, the original token/metadata are returned without another
// wallet debit.  The caller can safely replay the full secret in that case.
func CreatePrepaidResellerTokenWithRequestID(token *Token, metadata *ResellerKey, walletQuota int, requestID string) (bool, *ResellerKeyWithToken, error) {
	if token == nil || metadata == nil {
		return false, nil, errors.New("reseller token and metadata are required")
	}
	if walletQuota <= 0 {
		return false, nil, errors.New("reseller wallet quota must be positive")
	}
	if err := common.ValidateWalletQuota(walletQuota); err != nil {
		return false, nil, err
	}
	if token.UserId <= 0 || metadata.UserId != token.UserId || !IsResellerTokenKey(token.Key) {
		return false, nil, errors.New("invalid reseller token ownership")
	}
	if token.Id != 0 {
		return false, nil, errors.New("reseller token id must be empty")
	}
	if token.UnlimitedQuota || metadata.TokenMillions <= 0 || metadata.TokenMillions > int(^uint(0)>>1)/1_000_000 ||
		token.RemainQuota != metadata.TokenMillions*1_000_000 || token.UsedQuota != 0 {
		return false, nil, errors.New("invalid reseller token allocation")
	}
	if metadata.MarkupPercent <= 0 || metadata.BaseCostPerMillion == "" || metadata.Endpoint == "" || metadata.CreatedTime != token.CreatedTime {
		return false, nil, errors.New("invalid reseller commercial metadata")
	}
	requestID = strings.TrimSpace(requestID)
	if utf8.RuneCountInString(requestID) > 128 || strings.ContainsAny(requestID, "\r\n") {
		return false, nil, errors.New("invalid reseller request id")
	}
	insufficientBalance := false
	createdRecord := (*ResellerKeyWithToken)(nil)
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Lock the owner's row so concurrent purchases (including the same
		// idempotency key) serialize on every supported SQL dialect.
		var owner User
		if err := lockForUpdate(tx).Where("id = ?", token.UserId).First(&owner).Error; err != nil {
			return err
		}
		if requestID != "" {
			var existingMetadata ResellerKey
			lookupErr := tx.Where("user_id = ? AND request_id = ?", token.UserId, requestID).First(&existingMetadata).Error
			if lookupErr == nil {
				var existingToken Token
				if err := tx.Where("id = ? AND user_id = ?", existingMetadata.TokenId, token.UserId).First(&existingToken).Error; err != nil {
					return err
				}
				createdRecord = &ResellerKeyWithToken{Metadata: existingMetadata, Token: existingToken}
				return nil
			}
			if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				return lookupErr
			}
			requestIDCopy := requestID
			metadata.RequestId = &requestIDCopy
		}

		result := tx.Model(&User{}).
			Where("id = ? AND quota >= ?", token.UserId, walletQuota).
			Update("quota", gorm.Expr("quota - ?", walletQuota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			insufficientBalance = true
			return errResellerWalletInsufficient
		}
		if err := tx.Create(token).Error; err != nil {
			return err
		}
		metadata.TokenId = token.Id
		if err := tx.Create(metadata).Error; err != nil {
			return err
		}
		createdRecord = &ResellerKeyWithToken{Metadata: *metadata, Token: *token}
		return nil
	})
	if err != nil {
		if insufficientBalance {
			return false, nil, nil
		}
		return false, nil, err
	}
	if createdRecord != nil && createdRecord.Token.Id == token.Id {
		if cacheErr := invalidateUserCache(token.UserId); cacheErr != nil {
			common.SysLog("failed to invalidate user quota cache after reseller purchase: " + cacheErr.Error())
		}
	}
	return createdRecord != nil && createdRecord.Token.Id == token.Id, createdRecord, nil
}

func reserveResellerTokenQuota(id int, key string, quota int) (bool, error) {
	key = strings.TrimPrefix(key, "sk-")
	// SQL is the sole authority for prepaid allocations.  Cache fencing is
	// best-effort around the mutation: a Redis outage must not reject a valid
	// debit, and cannot permit overspending because the conditional UPDATE below
	// checks the durable remaining balance.
	if err := invalidateTokenCacheForMutation(key); err != nil {
		common.SysLog("failed to invalidate reseller token cache before debit: " + err.Error())
	}
	result := DB.Model(&Token{}).
		Where("id = ? AND unlimited_quota = ? AND remain_quota >= ?", id, false, quota).
		Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).
		Updates(map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		})
	if result.Error != nil || result.RowsAffected != 1 {
		return false, result.Error
	}
	if err := invalidateTokenCacheForMutation(key); err != nil {
		common.SysLog("failed to refresh reseller token cache fence after debit: " + err.Error())
	}
	return true, nil
}

func decreaseResellerTokenQuota(id int, key string, quota int) error {
	reserved, err := reserveResellerTokenQuota(id, key, quota)
	if err != nil {
		return err
	}
	if !reserved {
		return ErrResellerTokenQuotaInsufficient
	}
	return nil
}

func increaseResellerTokenQuota(id int, key string, quota int) error {
	key = strings.TrimPrefix(key, "sk-")
	result := DB.Model(&Token{}).
		Where("id = ? AND used_quota >= ?", id, quota).
		Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).
		Updates(map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota + ?", quota),
			"used_quota":    gorm.Expr("used_quota - ?", quota),
			"accessed_time": common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	if err := invalidateTokenCacheForMutation(key); err != nil {
		// A stale cache can only understate the credited balance. Debits still use
		// conditional SQL, so cache availability must never prevent a refund.
		common.SysLog("failed to invalidate reseller token cache after credit: " + err.Error())
	}
	return nil
}

// ApplyResellerTokenQuotaAdjustment applies a signed durable quota mutation
// once. Positive values refund quota; negative values consume quota.
func ApplyResellerTokenQuotaAdjustment(id int, key string, adjustment int, operationID string) error {
	key = strings.TrimPrefix(key, "sk-")
	operationID = strings.TrimSpace(operationID)
	if id <= 0 || key == "" || operationID == "" || utf8.RuneCountInString(operationID) > 128 ||
		strings.ContainsAny(operationID, "\r\n") {
		return errors.New("invalid reseller quota operation")
	}
	if adjustment == 0 {
		return nil
	}
	if adjustment < common.MinQuota || adjustment > common.MaxQuota {
		return errors.New("reseller quota adjustment is out of range")
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var token Token
		if err := lockForUpdate(tx).
			Where("id = ? AND unlimited_quota = ?", id, false).
			Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).
			First(&token).Error; err != nil {
			return err
		}
		if !IsResellerTokenKey(token.Key) {
			return errors.New("token is not a reseller key")
		}

		var existing ResellerQuotaOperation
		lookup := tx.Where("operation_id = ?", operationID).First(&existing)
		if lookup.Error == nil {
			if existing.TokenId != id || existing.Adjustment != adjustment {
				return errors.New("reseller quota operation conflicts with an existing mutation")
			}
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}

		query := tx.Model(&Token{}).
			Where("id = ? AND unlimited_quota = ?", id, false).
			Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key})
		updates := map[string]interface{}{
			"accessed_time": common.GetTimestamp(),
		}
		if adjustment > 0 {
			query = query.Where("used_quota >= ?", adjustment)
			updates["remain_quota"] = gorm.Expr("remain_quota + ?", adjustment)
			updates["used_quota"] = gorm.Expr("used_quota - ?", adjustment)
		} else {
			amount := -adjustment
			query = query.Where("remain_quota >= ?", amount)
			updates["remain_quota"] = gorm.Expr("remain_quota - ?", amount)
			updates["used_quota"] = gorm.Expr("used_quota + ?", amount)
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrResellerTokenQuotaInsufficient
		}
		return tx.Create(&ResellerQuotaOperation{
			OperationId: operationID,
			TokenId:     id,
			UserId:      token.UserId,
			Adjustment:  adjustment,
			CreatedTime: common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		// A commit response can be ambiguous. If the operation marker is already
		// durable and matches, the mutation succeeded and must not be retried.
		var existing ResellerQuotaOperation
		if lookupErr := DB.Where("operation_id = ?", operationID).First(&existing).Error; lookupErr == nil &&
			existing.TokenId == id && existing.Adjustment == adjustment {
			err = nil
		}
	}
	if err != nil {
		return err
	}
	if cacheErr := invalidateTokenCacheForMutation(key); cacheErr != nil {
		common.SysLog("failed to invalidate reseller token cache after idempotent adjustment: " + cacheErr.Error())
	}
	return nil
}
