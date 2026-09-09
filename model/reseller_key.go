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
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrResellerTokenDeletionNotAllowed   = errors.New("reseller keys cannot be deleted; disable the key instead")
	ErrResellerTokenSecretUnavailable    = errors.New("reseller key secrets cannot be bulk exported")
	ErrResellerTokenQuotaInsufficient    = errors.New("reseller key quota is insufficient")
	ErrResellerQuotaAdjustmentInvalid    = errors.New("invalid reseller quota adjustment")
	ErrResellerQuotaAllocationOutOfRange = errors.New("reseller quota allocation must be between 1 and 1000 million tokens")
	ErrResellerQuotaOperationConflict    = errors.New("reseller quota operation conflicts with an existing mutation")
	ErrResellerQuotaStateConflict        = errors.New("reseller quota changed; refresh the key and retry")
	ErrResellerQuotaKeyExpired           = errors.New("expired reseller key quota cannot be increased")
	ErrResellerQuotaPurchaseRequired     = errors.New("reseller quota increase requires an authorized purchase")
	ErrResellerQuotaWalletInsufficient   = errors.New("insufficient balance to increase reseller quota")
	errResellerWalletInsufficient        = errors.New("reseller wallet quota is insufficient")
)

const (
	ResellerQuotaAdjustmentAdd      = "add"
	ResellerQuotaAdjustmentSubtract = "subtract"
	ResellerQuotaAdjustmentSet      = "set"
)

// ResellerKey stores commercial terms separately from the token secret.
// TokenMillions tracks the current purchased allocation. BaseCostPerMillion
// is an immutable decimal snapshot so later top-ups use the original price
// identically on SQLite, MySQL, and PostgreSQL.
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

type manualResellerQuotaOperation struct {
	Mode                  string
	RequestedMillions     int
	ExpectedTotalMillions int
}

func manualResellerQuotaOperationScope(userID int, tokenID int, requestID string) string {
	digest := common.Sha256Raw([]byte(strconv.Itoa(userID) + ":" + strconv.Itoa(tokenID) + ":" + requestID))
	return fmt.Sprintf("manual:%x", digest)
}

func (operation manualResellerQuotaOperation) durableID(scope string) string {
	return scope + ":" + operation.Mode + ":" + strconv.Itoa(operation.RequestedMillions) + ":" +
		strconv.Itoa(operation.ExpectedTotalMillions)
}

func parseManualResellerQuotaOperation(scope string, durableID string) (manualResellerQuotaOperation, bool) {
	var operation manualResellerQuotaOperation
	prefix := scope + ":"
	if !strings.HasPrefix(durableID, prefix) {
		return operation, false
	}
	parts := strings.Split(strings.TrimPrefix(durableID, prefix), ":")
	if len(parts) != 3 {
		return operation, false
	}
	requestedMillions, err := strconv.Atoi(parts[1])
	if err != nil {
		return operation, false
	}
	expectedTotalMillions, err := strconv.Atoi(parts[2])
	if err != nil {
		return operation, false
	}
	operation = manualResellerQuotaOperation{
		Mode:                  parts[0],
		RequestedMillions:     requestedMillions,
		ExpectedTotalMillions: expectedTotalMillions,
	}
	return operation, true
}

// AdjustResellerTokenQuota changes the purchased allocation of an owned
// reseller key in whole millions. Increasing it charges the owner's wallet at
// the key's snapshotted cost, while decreasing it discards only unused quota
// and never refunds money. The wallet, token, metadata, and idempotency marker
// are committed in one transaction.
func AdjustResellerTokenQuota(id int, userID int, mode string, amountMillions int, expectedTotalMillions int, requestID string, purchaseAuthorized bool) (*ResellerKeyWithToken, bool, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	requestID = strings.TrimSpace(requestID)
	if id <= 0 || userID <= 0 || requestID == "" || utf8.RuneCountInString(requestID) > 128 ||
		strings.IndexFunc(requestID, unicode.IsControl) >= 0 {
		return nil, false, ErrResellerQuotaAdjustmentInvalid
	}
	if mode != ResellerQuotaAdjustmentAdd && mode != ResellerQuotaAdjustmentSubtract &&
		mode != ResellerQuotaAdjustmentSet {
		return nil, false, ErrResellerQuotaAdjustmentInvalid
	}
	if amountMillions <= 0 || amountMillions > 1000 || expectedTotalMillions <= 0 || expectedTotalMillions > 1000 {
		return nil, false, ErrResellerQuotaAdjustmentInvalid
	}
	requestScope := manualResellerQuotaOperationScope(userID, id, requestID)

	var result ResellerKeyWithToken
	var previousKey string
	var durableOperationID string
	applied := false
	walletDebited := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Keep the lock order aligned with reseller purchases: owner first, then
		// token and metadata. This avoids deadlocks with concurrent paid actions.
		var owner User
		if err := lockForUpdate(tx).Where("id = ?", userID).First(&owner).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", id, userID).First(&result.Token).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return gorm.ErrRecordNotFound
			}
			return err
		}
		if !IsResellerTokenKey(result.Token.Key) || !result.Token.UsesTokenQuota() || result.Token.UnlimitedQuota {
			return ErrResellerQuotaAdjustmentInvalid
		}
		previousKey = result.Token.Key
		if err := lockForUpdate(tx).Where("token_id = ? AND user_id = ?", id, userID).First(&result.Metadata).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return gorm.ErrRecordNotFound
			}
			return err
		}
		if result.Metadata.TokenMillions <= 0 || result.Metadata.TokenMillions > 1000 {
			return ErrResellerQuotaAdjustmentInvalid
		}
		currentAllocation, err := common.QuotaFromDecimalStrict(
			decimal.NewFromInt(int64(result.Metadata.TokenMillions)).Mul(decimal.NewFromInt(1_000_000)),
		)
		if err != nil || result.Token.RemainQuota < 0 || result.Token.UsedQuota < 0 ||
			result.Token.RemainQuota > currentAllocation || result.Token.UsedQuota > currentAllocation ||
			result.Token.RemainQuota+result.Token.UsedQuota != currentAllocation {
			return ErrResellerQuotaAdjustmentInvalid
		}

		// A matching marker makes retries read-only. Return the currently locked
		// key state so a late replay cannot replace newer UI state with stale data.
		var existing ResellerQuotaOperation
		lookup := tx.Where("operation_id LIKE ?", requestScope+":%").First(&existing)
		if lookup.Error == nil {
			operation, ok := parseManualResellerQuotaOperation(requestScope, existing.OperationId)
			if !ok || operation.Mode != mode || operation.RequestedMillions != amountMillions ||
				operation.ExpectedTotalMillions != expectedTotalMillions ||
				existing.TokenId != id || existing.UserId != userID {
				return ErrResellerQuotaOperationConflict
			}
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}
		if result.Metadata.TokenMillions != expectedTotalMillions {
			return ErrResellerQuotaStateConflict
		}

		targetTotalMillions := result.Metadata.TokenMillions
		switch mode {
		case ResellerQuotaAdjustmentAdd:
			targetTotalMillions += amountMillions
		case ResellerQuotaAdjustmentSubtract:
			targetTotalMillions -= amountMillions
		case ResellerQuotaAdjustmentSet:
			targetTotalMillions = amountMillions
		}
		if targetTotalMillions < 1 || targetTotalMillions > 1000 {
			return ErrResellerQuotaAllocationOutOfRange
		}
		targetAllocation, err := common.QuotaFromDecimalStrict(
			decimal.NewFromInt(int64(targetTotalMillions)).Mul(decimal.NewFromInt(1_000_000)),
		)
		if err != nil {
			return ErrResellerQuotaAdjustmentInvalid
		}
		if targetAllocation < result.Token.UsedQuota {
			return ErrResellerTokenQuotaInsufficient
		}
		deltaMillions := targetTotalMillions - result.Metadata.TokenMillions
		deltaTokens := targetAllocation - currentAllocation
		if deltaMillions > 0 {
			if result.Token.ExpiredTime != -1 && result.Token.ExpiredTime <= common.GetTimestamp() {
				return ErrResellerQuotaKeyExpired
			}
			if !purchaseAuthorized {
				return ErrResellerQuotaPurchaseRequired
			}
			activeSubscription, err := getActiveResellerSubscriptionAt(tx, userID, common.GetTimestamp())
			if err != nil {
				return err
			}
			if activeSubscription == nil {
				return ErrResellerSubscriptionRequired
			}
			baseCost, err := decimal.NewFromString(result.Metadata.BaseCostPerMillion)
			if err != nil || !baseCost.IsPositive() {
				return ErrResellerQuotaAdjustmentInvalid
			}
			purchaseCost := decimal.NewFromInt(int64(deltaMillions)).Mul(baseCost).Round(2)
			walletQuota, err := common.WalletQuotaFromDecimalStrict(
				purchaseCost.Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
			)
			if err != nil || walletQuota <= 0 {
				return ErrResellerQuotaAdjustmentInvalid
			}
			walletResult := tx.Model(&User{}).
				Where("id = ? AND quota >= ?", userID, walletQuota).
				Update("quota", gorm.Expr("quota - ?", walletQuota))
			if walletResult.Error != nil {
				return walletResult.Error
			}
			if walletResult.RowsAffected != 1 {
				return ErrResellerQuotaWalletInsufficient
			}
			walletDebited = true
		}

		// Fence readers before the token row changes. Otherwise a concurrent cache
		// miss can publish its pre-mutation snapshot after the transaction commits
		// and the post-commit invalidation has run.
		if cacheErr := invalidateTokenCacheForMutation(previousKey); cacheErr != nil {
			common.SysLog("failed to fence reseller token cache before manual quota adjustment: " + cacheErr.Error())
		}
		result.Metadata.TokenMillions = targetTotalMillions
		result.Token.RemainQuota += deltaTokens
		if result.Token.RemainQuota < 0 || result.Token.RemainQuota+result.Token.UsedQuota != targetAllocation {
			return ErrResellerQuotaAdjustmentInvalid
		}
		if err := tx.Model(&Token{}).Where("id = ? AND user_id = ?", id, userID).
			Update("remain_quota", result.Token.RemainQuota).Error; err != nil {
			return err
		}
		metadataUpdate := tx.Model(&ResellerKey{}).
			Where("token_id = ? AND user_id = ? AND token_millions = ?", id, userID, expectedTotalMillions).
			Update("token_millions", result.Metadata.TokenMillions)
		if metadataUpdate.Error != nil {
			return metadataUpdate.Error
		}
		if metadataUpdate.RowsAffected != 1 && deltaMillions != 0 {
			return ErrResellerQuotaStateConflict
		}
		operation := manualResellerQuotaOperation{
			Mode:                  mode,
			RequestedMillions:     amountMillions,
			ExpectedTotalMillions: expectedTotalMillions,
		}
		durableOperationID = operation.durableID(requestScope)
		if utf8.RuneCountInString(durableOperationID) > 128 {
			return ErrResellerQuotaAdjustmentInvalid
		}
		if err := tx.Create(&ResellerQuotaOperation{
			OperationId: durableOperationID,
			TokenId:     id,
			UserId:      userID,
			Adjustment:  deltaTokens,
			CreatedTime: common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	if err != nil {
		// If the transaction lost a race at the unique operation index, treat a
		// matching durable marker as a successful replay. This also covers an
		// ambiguous commit response without applying a second adjustment.
		var existing ResellerQuotaOperation
		if lookupErr := DB.Where("operation_id LIKE ?", requestScope+":%").First(&existing).Error; lookupErr == nil &&
			existing.TokenId == id && existing.UserId == userID {
			operation, ok := parseManualResellerQuotaOperation(requestScope, existing.OperationId)
			var token Token
			if ok && operation.Mode == mode && operation.RequestedMillions == amountMillions &&
				operation.ExpectedTotalMillions == expectedTotalMillions {
				if tokenErr := DB.Where("id = ? AND user_id = ?", id, userID).First(&token).Error; tokenErr == nil {
					var metadata ResellerKey
					if metadataErr := DB.Where("token_id = ? AND user_id = ?", id, userID).First(&metadata).Error; metadataErr == nil {
						result = ResellerKeyWithToken{Metadata: metadata, Token: token}
						previousKey = token.Key
						err = nil
					}
				}
			}
		}
	}
	if err != nil {
		return nil, false, err
	}
	paidAdjustment := mode == ResellerQuotaAdjustmentAdd ||
		(mode == ResellerQuotaAdjustmentSet && amountMillions > expectedTotalMillions)
	if walletDebited || paidAdjustment {
		if cacheErr := invalidateUserCache(userID); cacheErr != nil {
			common.SysLog("failed to invalidate user quota cache after reseller quota purchase: " + cacheErr.Error())
		}
	}
	// Successful idempotent replays reconcile caches as well. The original
	// process may have stopped after the durable commit but before invalidation.
	if cacheErr := invalidateTokenCacheForMutation(previousKey); cacheErr != nil {
		common.SysLog("failed to invalidate reseller token cache after manual quota adjustment: " + cacheErr.Error())
	}
	return &result, applied, nil
}

func GetUserResellerKeyByTokenID(userID int, tokenID int) (*ResellerKeyWithToken, error) {
	if userID <= 0 || tokenID <= 0 {
		return nil, gorm.ErrRecordNotFound
	}
	var record ResellerKeyWithToken
	if err := DB.Where("id = ? AND user_id = ?", tokenID, userID).First(&record.Token).Error; err != nil {
		return nil, err
	}
	if !IsResellerTokenKey(record.Token.Key) {
		return nil, gorm.ErrRecordNotFound
	}
	if err := DB.Where("token_id = ? AND user_id = ?", tokenID, userID).First(&record.Metadata).Error; err != nil {
		return nil, err
	}
	return &record, nil
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

func GetResellerKeyByRequestID(userId int, requestID string) (*ResellerKeyWithToken, error) {
	return getResellerKeyByRequestID(DB, userId, requestID)
}

// DeleteResellerToken permanently removes a reseller key and its commercial
// metadata. Purchased quota is intentionally not refunded.
func DeleteResellerToken(id int, userId int) error {
	if id <= 0 || userId <= 0 {
		return errors.New("invalid reseller token owner")
	}
	var token Token
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", id, userId).First(&token).Error; err != nil {
			return err
		}
		if !IsResellerTokenKey(token.Key) {
			return errors.New("token is not a reseller key")
		}
		if err := tx.Where("token_id = ? AND user_id = ?", id, userId).Delete(&ResellerKey{}).Error; err != nil {
			return err
		}
		return tx.Delete(&token).Error
	})
	if err != nil {
		return err
	}
	if cacheErr := invalidateTokenCacheForMutation(token.Key); cacheErr != nil {
		common.SysLog("failed to invalidate reseller token cache after deletion: " + cacheErr.Error())
	}
	return nil
}

// ReissueResellerToken rotates only the secret. The purchased quota, routing
// group, expiration, status, and commercial snapshot stay unchanged.
func ReissueResellerToken(id int, userId int) (*ResellerKeyWithToken, error) {
	if id <= 0 || userId <= 0 {
		return nil, errors.New("invalid reseller token owner")
	}
	newKey, err := NewResellerTokenKey()
	if err != nil {
		return nil, err
	}
	var result ResellerKeyWithToken
	oldKey := ""
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", id, userId).First(&result.Token).Error; err != nil {
			return err
		}
		if !IsResellerTokenKey(result.Token.Key) {
			return errors.New("token is not a reseller key")
		}
		oldKey = result.Token.Key
		if cacheErr := invalidateTokenCacheForMutation(oldKey); cacheErr != nil {
			common.SysLog("failed to fence reseller token cache before reissue: " + cacheErr.Error())
		}
		if err := tx.Where("token_id = ? AND user_id = ?", id, userId).First(&result.Metadata).Error; err != nil {
			return err
		}
		if err := tx.Model(&Token{}).Where("id = ? AND user_id = ?", id, userId).
			Update("key", newKey).Error; err != nil {
			return err
		}
		result.Token.Key = newKey
		return nil
	})
	if err != nil {
		return nil, err
	}
	if cacheErr := invalidateTokenCacheForMutation(oldKey); cacheErr != nil {
		common.SysLog("failed to invalidate previous reseller token cache after reissue: " + cacheErr.Error())
	}
	if cacheErr := invalidateTokenCacheForMutation(result.Token.Key); cacheErr != nil {
		common.SysLog("failed to invalidate reissued reseller token cache: " + cacheErr.Error())
	}
	return &result, nil
}

func getResellerKeyByRequestID(db *gorm.DB, userId int, requestID string) (*ResellerKeyWithToken, error) {
	var metadata ResellerKey
	err := db.Where("user_id = ? AND request_id = ?", userId, requestID).First(&metadata).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var token Token
	if err := db.Where("id = ? AND user_id = ?", metadata.TokenId, userId).First(&token).Error; err != nil {
		return nil, err
	}
	if !IsResellerTokenKey(token.Key) {
		return nil, fmt.Errorf("reseller key metadata references non-reseller token %d", metadata.TokenId)
	}
	return &ResellerKeyWithToken{Metadata: metadata, Token: token}, nil
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
	if token.UserId <= 0 || metadata.UserId != token.UserId || !IsResellerTokenKey(token.Key) || token.Group == "" || token.Group == "auto" {
		return false, nil, errors.New("invalid reseller token ownership")
	}
	if token.Id != 0 {
		return false, nil, errors.New("reseller token id must be empty")
	}
	if token.UnlimitedQuota || metadata.TokenMillions <= 0 || metadata.TokenMillions > int(^uint(0)>>1)/1_000_000 ||
		token.RemainQuota != metadata.TokenMillions*1_000_000 || token.UsedQuota != 0 {
		return false, nil, errors.New("invalid reseller token allocation")
	}
	token.QuotaMode = TokenQuotaModeTokens
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
			existingRecord, lookupErr := getResellerKeyByRequestID(tx, token.UserId, requestID)
			if lookupErr != nil {
				return lookupErr
			}
			if existingRecord != nil {
				createdRecord = existingRecord
				return nil
			}
			requestIDCopy := requestID
			metadata.RequestId = &requestIDCopy
		}

		activeSubscription, err := getActiveResellerSubscriptionAt(tx, token.UserId, common.GetTimestamp())
		if err != nil {
			return err
		}
		if activeSubscription == nil {
			return ErrResellerSubscriptionRequired
		}

		var tokenCount int64
		if err := tx.Model(&Token{}).Where("user_id = ?", token.UserId).Count(&tokenCount).Error; err != nil {
			return err
		}
		if tokenCount >= int64(operation_setting.GetMaxUserTokens()) {
			return ErrResellerTokenLimitReached
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
		Where("id = ? AND unlimited_quota = ? AND remain_quota >= ? AND status = ?", id, false, quota, common.TokenStatusEnabled).
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

// ApplyTokenQuotaAdjustmentOnce applies a signed durable mutation to a
// raw-token key exactly once. Positive values refund quota; negative values
// consume quota. The existing operation ledger is shared with reseller keys
// so an ambiguous commit can be recognized safely on retry.
func ApplyTokenQuotaAdjustmentOnce(id int, key string, adjustment int, operationID string) error {
	return applyTokenQuotaAdjustmentOnce(id, key, adjustment, operationID, false)
}

// ReserveResellerTokenQuota reserves a new request only while the durable key
// is enabled. Settlements and refunds of requests already in flight remain
// allowed after the key is disabled. A committed reservation replay is a no-op.
func ReserveResellerTokenQuota(id int, key string, amount int, operationID string) error {
	if !IsResellerTokenKey(key) || amount <= 0 || amount > common.MaxQuota {
		return ErrResellerQuotaAdjustmentInvalid
	}
	err := applyTokenQuotaAdjustmentOnce(id, key, -amount, operationID, true)
	if errors.Is(err, ErrTokenQuotaInsufficient) {
		return ErrResellerTokenQuotaInsufficient
	}
	return err
}

func applyTokenQuotaAdjustmentOnce(id int, key string, adjustment int, operationID string, reservation bool) error {
	key = strings.TrimPrefix(key, "sk-")
	operationID = strings.TrimSpace(operationID)
	if id <= 0 || key == "" || operationID == "" || utf8.RuneCountInString(operationID) > 128 ||
		strings.ContainsAny(operationID, "\r\n") {
		return errors.New("invalid token quota operation")
	}
	if adjustment == 0 {
		return nil
	}
	if adjustment < common.MinQuota || adjustment > common.MaxQuota {
		return errors.New("token quota adjustment is out of range")
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing ResellerQuotaOperation
		lookup := tx.Where("operation_id = ?", operationID).First(&existing)
		if lookup.Error == nil {
			if existing.TokenId != id || existing.Adjustment != adjustment {
				return errors.New("token quota operation conflicts with an existing mutation")
			}
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}

		var token Token
		if err := lockForUpdate(tx).
			Where("id = ?", id).
			Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).
			First(&token).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTokenQuotaTargetNotFound
		} else if err != nil {
			return err
		}
		if !token.UsesTokenQuota() {
			return errors.New("token does not use raw-token quota")
		}
		if reservation && (token.Status != common.TokenStatusEnabled || token.UnlimitedQuota ||
			(token.ExpiredTime != -1 && token.ExpiredTime <= common.GetTimestamp())) {
			return ErrTokenQuotaInsufficient
		}
		if reservation && (token.RemainQuota < 0 || token.UsedQuota < 0 || token.UsedQuota > common.MaxQuota ||
			token.RemainQuota > common.MaxQuota-token.UsedQuota) {
			return ErrResellerQuotaAdjustmentInvalid
		}
		if token.UnlimitedQuota {
			// Unlimited keys preserve the historical semantics of money-denominated
			// tokens: their wallet/subscription usage is billable, but the key's
			// remain/used counters are not a hard cap and must never be mutated by
			// raw-token reservation or settlement.
			return nil
		}

		query := tx.Model(&Token{}).
			Where("id = ?", id).
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
			if !token.UnlimitedQuota {
				query = query.Where("remain_quota >= ?", amount)
			}
			updates["remain_quota"] = gorm.Expr("remain_quota - ?", amount)
			updates["used_quota"] = gorm.Expr("used_quota + ?", amount)
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			var count int64
			if err := tx.Model(&Token{}).
				Where("id = ?", id).
				Where(clause.Eq{Column: clause.Column{Name: "key"}, Value: key}).
				Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrTokenQuotaTargetNotFound
			}
			return ErrTokenQuotaInsufficient
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
		common.SysLog("failed to invalidate raw token cache after idempotent adjustment: " + cacheErr.Error())
	}
	return nil
}

// SettleResellerTokenQuota settles measured usage against an existing request
// reservation. It returns the total charged for this request, which can be less
// than actual only when the remaining prepaid allocation is insufficient. That
// shortage consumes the available balance and disables the key atomically.
// The caller must audit actual-charged; no negative balance or wallet debit is
// created. The immutable ID belongs to the already-authenticated request, so an
// in-flight settlement remains valid after its reseller secret is rotated.
func SettleResellerTokenQuota(id int, key string, reserved int, actual int, operationID string) (int, error) {
	key = strings.TrimPrefix(key, "sk-")
	operationID = strings.TrimSpace(operationID)
	if id <= 0 || !IsResellerTokenKey(key) || operationID == "" || utf8.RuneCountInString(operationID) > 128 ||
		strings.IndexFunc(operationID, unicode.IsControl) >= 0 || reserved < 0 || actual < 0 ||
		reserved > common.MaxQuota || actual > common.MaxQuota {
		return 0, ErrResellerQuotaAdjustmentInvalid
	}
	// Include the immutable arguments in the existing marker without adding a
	// column. The token lock serializes operations sharing a request scope, even
	// if a buggy caller retries the same operation with different usage.
	digest := common.Sha256Raw([]byte(strconv.Itoa(id) + ":" + operationID))
	scope := fmt.Sprintf("settle:%x:", digest)
	durableID := scope + strconv.Itoa(reserved) + ":" + strconv.Itoa(actual)
	charged := 0
	currentKey := key
	err := DB.Transaction(func(tx *gorm.DB) error {
		var token Token
		if err := lockForUpdate(tx).Where("id = ?", id).First(&token).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenQuotaTargetNotFound
			}
			return err
		}
		if !IsResellerTokenKey(token.Key) || !token.UsesTokenQuota() || token.UnlimitedQuota {
			return ErrResellerQuotaAdjustmentInvalid
		}
		currentKey = token.Key
		var existing ResellerQuotaOperation
		lookup := tx.Where("operation_id LIKE ?", scope+"%").First(&existing)
		if lookup.Error == nil {
			if existing.TokenId != id || existing.OperationId != durableID ||
				existing.Adjustment < reserved-actual || existing.Adjustment > reserved {
				return ErrResellerQuotaOperationConflict
			}
			charged = reserved - existing.Adjustment
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}
		if token.RemainQuota < 0 || token.UsedQuota < reserved || token.UsedQuota > common.MaxQuota ||
			token.RemainQuota > common.MaxQuota-token.UsedQuota {
			return ErrResellerQuotaAdjustmentInvalid
		}

		charged = actual
		adjustment := reserved - actual
		shortage := actual > reserved && actual-reserved > token.RemainQuota
		if shortage {
			// Both terms are nonnegative and their sum is bounded by actual.
			charged = reserved + token.RemainQuota
			adjustment = -token.RemainQuota
		}
		updates := map[string]interface{}{"accessed_time": common.GetTimestamp()}
		if adjustment != 0 {
			updates["remain_quota"] = gorm.Expr("remain_quota + ?", adjustment)
			updates["used_quota"] = gorm.Expr("used_quota - ?", adjustment)
		}
		if shortage {
			updates["status"] = common.TokenStatusDisabled
		}
		if cacheErr := invalidateTokenCacheForMutation(currentKey); cacheErr != nil {
			common.SysLog("failed to fence reseller token cache before settlement: " + cacheErr.Error())
		}
		query := tx.Model(&Token{}).Where("id = ?", id)
		if adjustment > 0 {
			query = query.Where("used_quota >= ?", adjustment)
		} else if adjustment < 0 {
			query = query.Where("remain_quota >= ?", -adjustment)
		}
		if err := query.Updates(updates).Error; err != nil {
			return err
		}
		// Zero-delta settlements also need a marker: a later retry must not
		// consume funds that were added after an already-finalized shortage.
		return tx.Create(&ResellerQuotaOperation{
			OperationId: durableID, TokenId: id, UserId: token.UserId,
			Adjustment: adjustment, CreatedTime: common.GetTimestamp(),
		}).Error
	})
	if err != nil {
		// A commit acknowledgement can be lost after both writes became durable.
		var existing ResellerQuotaOperation
		if lookupErr := DB.Where("operation_id LIKE ?", scope+"%").First(&existing).Error; lookupErr == nil {
			if existing.TokenId != id || existing.OperationId != durableID ||
				existing.Adjustment < reserved-actual || existing.Adjustment > reserved {
				return 0, ErrResellerQuotaOperationConflict
			}
			charged = reserved - existing.Adjustment
			err = nil
		}
	}
	if err != nil {
		return 0, err
	}
	for _, cacheKey := range []string{key, currentKey} {
		if cacheErr := invalidateTokenCacheForMutation(cacheKey); cacheErr != nil {
			common.SysLog("failed to invalidate reseller token cache after settlement: " + cacheErr.Error())
		}
	}
	return charged, nil
}

// ApplyResellerTokenQuotaAdjustment preserves the reseller-specific API and
// error contract while using the shared raw-token idempotency ledger.
func ApplyResellerTokenQuotaAdjustment(id int, key string, adjustment int, operationID string) error {
	if !IsResellerTokenKey(key) {
		return errors.New("token is not a reseller key")
	}
	currentKey := key
	for range 2 {
		err := ApplyTokenQuotaAdjustmentOnce(id, currentKey, adjustment, operationID)
		if errors.Is(err, ErrTokenQuotaInsufficient) {
			return ErrResellerTokenQuotaInsufficient
		}
		if !errors.Is(err, ErrTokenQuotaTargetNotFound) {
			return err
		}

		// A secret may be rotated while a request is in flight. The immutable ID
		// remains the billing identity, so retry against the current reseller
		// secret without changing the operation marker.
		var token Token
		if lookupErr := DB.Select("id", "key").Where("id = ?", id).First(&token).Error; lookupErr != nil {
			return lookupErr
		}
		if !IsResellerTokenKey(token.Key) {
			return ErrTokenQuotaTargetNotFound
		}
		currentKey = token.Key
	}
	return ErrTokenQuotaTargetNotFound
}
