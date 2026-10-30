package model

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func newResellerPurchase(t *testing.T, userId int, millions int) (Token, ResellerKey) {
	t.Helper()
	var subscriptionCount int64
	require.NoError(t, DB.Model(&ResellerSubscription{}).Where("user_id = ?", userId).Count(&subscriptionCount).Error)
	if subscriptionCount == 0 {
		now := common.GetTimestamp()
		require.NoError(t, DB.Create(&ResellerSubscription{
			UserId: userId, Status: ResellerSubscriptionStatusActive,
			StartTime: now - 1, EndTime: now + 30*24*60*60,
			ListPrice: "10.00", DiscountPercent: 0, PaidPrice: "10.00",
			ChargedQuota: 10, DurationDays: 30, RequestId: "test-entitlement", CreatedTime: now - 1,
		}).Error)
	}
	key, err := NewResellerTokenKey()
	require.NoError(t, err)
	now := common.GetTimestamp()
	return Token{
			UserId: userId, Key: key, Name: "client", Status: common.TokenStatusEnabled,
			CreatedTime: now, AccessedTime: now, ExpiredTime: -1,
			RemainQuota: millions * 1_000_000, UnlimitedQuota: false, Group: "default",
		}, ResellerKey{
			UserId: userId, TokenMillions: millions, MarkupPercent: 80,
			BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: now,
		}
}

func TestCreatePrepaidResellerTokenCommitsPurchaseAtomically(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 10)

	created, err := CreatePrepaidResellerToken(&token, &metadata, 400)
	require.NoError(t, err)
	require.True(t, created)
	assert.Equal(t, 600, getUserQuotaFromDB(t, user.Id))
	assert.Positive(t, token.Id)
	assert.Positive(t, metadata.Id)
	assert.Equal(t, token.Id, metadata.TokenId)
	require.NoError(t, DB.First(&Token{}, token.Id).Error)
	require.NoError(t, DB.First(&ResellerKey{}, metadata.Id).Error)
}

func TestCreatePrepaidResellerTokenWithRequestIDIsIdempotent(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)

	created, first, err := CreatePrepaidResellerTokenWithRequestID(&token, &metadata, 400, "issue-123")
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, first)
	require.NotNil(t, first.Metadata.RequestId)
	assert.Equal(t, "issue-123", *first.Metadata.RequestId)
	require.NoError(t, DB.Model(&ResellerSubscription{}).
		Where("user_id = ?", user.Id).
		Update("end_time", common.GetTimestamp()-1).Error)

	secondToken, secondMetadata := newResellerPurchase(t, user.Id, 50)
	created, replay, err := CreatePrepaidResellerTokenWithRequestID(&secondToken, &secondMetadata, 999, "issue-123")
	require.NoError(t, err)
	assert.False(t, created)
	require.NotNil(t, replay)
	assert.Equal(t, first.Token.Id, replay.Token.Id)
	assert.Equal(t, first.Token.Key, replay.Token.Key)
	assert.Equal(t, first.Metadata.TokenMillions, replay.Metadata.TokenMillions)
	assert.Equal(t, 600, getUserQuotaFromDB(t, user.Id), "replay must not debit the wallet")
	var tokenCount int64
	require.NoError(t, DB.Model(&Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
}

func TestCreatePrepaidResellerTokenRequiresActiveSubscription(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	require.NoError(t, DB.Where("user_id = ?", user.Id).Delete(&ResellerSubscription{}).Error)

	created, record, err := CreatePrepaidResellerTokenWithRequestID(&token, &metadata, 100, "issue-without-access")

	assert.False(t, created)
	assert.Nil(t, record)
	assert.ErrorIs(t, err, ErrResellerSubscriptionRequired)
	assert.Equal(t, 1_000, getUserQuotaFromDB(t, user.Id))
}

func TestCreatePrepaidResellerTokenLeavesNoPartialState(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	user := createReserveTestUser(t, 1_000)
	require.NoError(t, populateUserCache(user))
	require.NoError(t, DB.Create(&ResellerKey{
		Id: 1, TokenId: 999, UserId: user.Id, TokenMillions: 1, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: 1,
	}).Error)
	token, metadata := newResellerPurchase(t, user.Id, 10)
	metadata.Id = 1

	created, err := CreatePrepaidResellerToken(&token, &metadata, 400)
	assert.False(t, created)
	assert.Error(t, err)
	assert.Equal(t, 1_000, getUserQuotaFromDB(t, user.Id))
	cached, cacheErr := GetUserCache(user.Id)
	require.NoError(t, cacheErr)
	assert.Equal(t, 1_000, cached.Quota)
	var tokenCount int64
	require.NoError(t, DB.Model(&Token{}).Count(&tokenCount).Error)
	assert.Zero(t, tokenCount)
}

func TestCreatePrepaidResellerTokenUsesDurableWalletWithoutRedisInBatchMode(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true
	common.RedisEnabled = false
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)

	created, err := CreatePrepaidResellerToken(&token, &metadata, 400)

	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, 600, getUserQuotaFromDB(t, user.Id))
	var tokenCount int64
	require.NoError(t, DB.Model(&Token{}).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
}

func TestPrepaidPurchaseAndUsageBypassBatchUpdates(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	user := createReserveTestUser(t, 1_000)
	require.NoError(t, populateUserCache(user))
	token, metadata := newResellerPurchase(t, user.Id, 1)

	created, err := CreatePrepaidResellerToken(&token, &metadata, 400)
	require.NoError(t, err)
	require.True(t, created)
	assert.Equal(t, 600, getUserQuotaFromDB(t, user.Id), "purchase debit must be durable before returning")
	cachedUser, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 600, cachedUser.Quota)

	_, err = GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	reserved, err := TryReserveTokenQuota(token.Id, token.Key, 600_000, false)
	require.NoError(t, err)
	require.True(t, reserved)
	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, 400_000, stored.RemainQuota)
	assert.Equal(t, 600_000, stored.UsedQuota)

	reserved, err = TryReserveTokenQuota(token.Id, token.Key, 400_001, false)
	require.NoError(t, err)
	assert.False(t, reserved, "a stale cache or pending batch must not authorize a second spend")
	assert.Equal(t, 400_000, getTokenFromDB(t, token.Id).RemainQuota)

	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 100_000))
	stored = getTokenFromDB(t, token.Id)
	assert.Equal(t, 500_000, stored.RemainQuota)
	assert.Equal(t, 500_000, stored.UsedQuota)
	batchUpdateLocks[BatchUpdateTypeTokenQuota].Lock()
	assert.Empty(t, batchUpdateStores[BatchUpdateTypeTokenQuota])
	batchUpdateLocks[BatchUpdateTypeTokenQuota].Unlock()

	server.FastForward(time.Duration(tokenCacheFenceSeconds+1) * time.Second)
	fresh, err := GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	assert.Equal(t, 500_000, fresh.RemainQuota)
}

func TestBatchWalletDebitIsVisibleBeforeResellerPurchase(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	user := createReserveTestUser(t, 1_000)
	require.NoError(t, DecreaseUserQuota(user.Id, 700, false))
	assert.Equal(t, 300, getUserQuotaFromDB(t, user.Id), "wallet debit must be durable when the call returns")
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	assert.NotContains(t, batchUpdateStores[BatchUpdateTypeUserQuota], user.Id)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
	require.NoError(t, invalidateUserCache(user.Id), "simulate cache eviction after the durable debit")

	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 400)
	require.NoError(t, err)
	assert.False(t, created, "cache eviction must not resurrect a spent wallet balance")
	assert.Equal(t, 300, getUserQuotaFromDB(t, user.Id))
}

func TestConcurrentResellerPurchasesCannotOverspendWallet(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	user := createReserveTestUser(t, 500)
	require.NoError(t, invalidateUserCache(user.Id), "start both purchases after cache eviction")

	type purchaseResult struct {
		created bool
		err     error
	}
	start := make(chan struct{})
	results := make(chan purchaseResult, 2)
	purchases := make([]struct {
		token    Token
		metadata ResellerKey
	}, 2)
	for index := range purchases {
		purchases[index].token, purchases[index].metadata = newResellerPurchase(t, user.Id, 1)
	}
	var waitGroup sync.WaitGroup
	for index := range purchases {
		waitGroup.Add(1)
		go func(purchase *struct {
			token    Token
			metadata ResellerKey
		}) {
			defer waitGroup.Done()
			<-start
			created, err := CreatePrepaidResellerToken(&purchase.token, &purchase.metadata, 400)
			results <- purchaseResult{created: created, err: err}
		}(&purchases[index])
	}
	close(start)
	waitGroup.Wait()
	close(results)

	createdCount := 0
	for result := range results {
		require.NoError(t, result.err)
		if result.created {
			createdCount++
		}
	}
	assert.Equal(t, 1, createdCount)
	assert.Equal(t, 100, getUserQuotaFromDB(t, user.Id))
	var tokenCount int64
	require.NoError(t, DB.Model(&Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Lock()
	assert.NotContains(t, batchUpdateStores[BatchUpdateTypeUserQuota], user.Id)
	batchUpdateLocks[BatchUpdateTypeUserQuota].Unlock()
}

func TestUpdateResellerMetadataCannotRestoreStaleQuota(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)
	stale := token

	reserved, err := TryReserveTokenQuota(token.Id, token.Key, 300_000, false)
	require.NoError(t, err)
	require.True(t, reserved)
	stale.Name = "renamed"
	stale.Status = common.TokenStatusDisabled
	stale.Group = "vip"
	require.NoError(t, stale.UpdateResellerMetadata())

	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, "renamed", stored.Name)
	assert.Equal(t, common.TokenStatusDisabled, stored.Status)
	assert.Equal(t, 700_000, stored.RemainQuota)
	assert.Equal(t, 300_000, stored.UsedQuota)
	assert.False(t, stored.UnlimitedQuota)
	assert.Equal(t, "default", stored.Group)
}

func TestUpdateResellerMetadataPersistsWhenRedisIsUnavailable(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)

	server.Close()
	token.Name = "disabled while redis is down"
	token.Status = common.TokenStatusDisabled
	require.NoError(t, token.UpdateResellerMetadata())

	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, "disabled while redis is down", stored.Name)
	assert.Equal(t, common.TokenStatusDisabled, stored.Status)
}

func TestUpdateResellerMetadataAssignsLegacyGroupOnlyOnce(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]interface{}{
		"group":             "",
		"cross_group_retry": true,
		"auto_groups":       `["default"]`,
	}).Error)

	token.Name = "legacy key"
	require.NoError(t, token.UpdateResellerMetadataWithLegacyGroup("vip"))

	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, "vip", stored.Group)
	assert.False(t, stored.CrossGroupRetry)
	assert.Empty(t, stored.AutoGroups)
	assert.Equal(t, 1_000_000, stored.RemainQuota)

	err = token.UpdateResellerMetadataWithLegacyGroup("default")
	require.ErrorContains(t, err, "group is immutable")
	stored = getTokenFromDB(t, token.Id)
	assert.Equal(t, "vip", stored.Group)
}

func TestResellerQuotaCreditPersistsWhenRedisIsUnavailable(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)
	reserved, err := TryReserveTokenQuota(token.Id, token.Key, 600_000, false)
	require.NoError(t, err)
	require.True(t, reserved)

	server.Close()
	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 500_000))
	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, 900_000, stored.RemainQuota)
	assert.Equal(t, 100_000, stored.UsedQuota)
}

func TestResellerQuotaDebitPersistsWhenRedisIsUnavailable(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	server := useUserCacheMiniRedis(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)
	server.Close()

	reserved, err := TryReserveTokenQuota(token.Id, token.Key, 600_000, false)
	require.NoError(t, err)
	assert.True(t, reserved, "Redis invalidation is an acceleration concern, not debit authority")
	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, 400_000, stored.RemainQuota)
	assert.Equal(t, 600_000, stored.UsedQuota)
}

func TestResellerQuotaAdjustmentIsIdempotent(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 1_000_000))

	require.NoError(t, ApplyResellerTokenQuotaAdjustment(token.Id, token.Key, 900_000, "request-1:settle"))
	require.NoError(t, ApplyResellerTokenQuotaAdjustment(token.Id, token.Key, 900_000, "request-1:settle"))
	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, 900_000, stored.RemainQuota)
	assert.Equal(t, 100_000, stored.UsedQuota)

	err = ApplyResellerTokenQuotaAdjustment(token.Id, token.Key, 800_000, "request-1:settle")
	assert.ErrorContains(t, err, "conflicts")
	stored = getTokenFromDB(t, token.Id)
	assert.Equal(t, 900_000, stored.RemainQuota)
	assert.Equal(t, 100_000, stored.UsedQuota)
}

func testResellerRequestSettlement(t *testing.T, db *gorm.DB, databaseType common.DatabaseType) {
	t.Helper()
	previousDB := DB
	previousMainType := common.MainDatabaseType()
	previousLogType := common.LogDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	DB = db
	common.SetDatabaseTypes(databaseType, previousLogType)
	common.RedisEnabled = false
	initCol()
	defer func() {
		DB = previousDB
		common.SetDatabaseTypes(previousMainType, previousLogType)
		common.RedisEnabled = previousRedisEnabled
		initCol()
	}()
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}, &ResellerQuotaOperation{}))
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	user := User{Username: "reseller-settle-" + suffix, AffCode: suffix, Password: "unused", Status: common.UserStatusEnabled, Quota: 1_000}
	require.NoError(t, db.Create(&user).Error)
	defer func() {
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&ResellerQuotaOperation{}).Error)
		require.NoError(t, db.Unscoped().Where("user_id = ?", user.Id).Delete(&Token{}).Error)
		require.NoError(t, db.Unscoped().Where("id = ?", user.Id).Delete(&User{}).Error)
	}()

	for index, tc := range []struct {
		name     string
		reserved int
		actual   int
		charged  int
		disabled bool
		rotate   bool
	}{
		{name: "debit beyond reservation", reserved: 100, actual: 350, charged: 350},
		{name: "return unused reservation", reserved: 700, actual: 200, charged: 200},
		{name: "explicit zero usage", reserved: 700, actual: 0, charged: 0},
		{name: "exact reservation", reserved: 700, actual: 700, charged: 700},
		{name: "shortage consumes available balance", reserved: 700, actual: 1_200, charged: 1_000, disabled: true},
		{name: "shortage with zero available balance", reserved: 1_000, actual: 1_200, charged: 1_000, disabled: true},
		{name: "settle after secret rotation", reserved: 700, actual: 200, charged: 200, rotate: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			key := "rsl_settle_" + suffix + "_" + strconv.Itoa(index)
			token := Token{UserId: user.Id, Key: key, Status: common.TokenStatusEnabled,
				ExpiredTime: -1, QuotaMode: TokenQuotaModeTokens, RemainQuota: 1_000}
			require.NoError(t, db.Create(&token).Error)
			opID := "request-" + suffix + "-" + strconv.Itoa(index)
			require.NoError(t, ReserveResellerTokenQuota(token.Id, key, tc.reserved, opID+":reserve"))
			if tc.rotate {
				require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]interface{}{
					"key": key + "_rotated", "status": common.TokenStatusDisabled,
				}).Error)
			}
			charged, err := SettleResellerTokenQuota(token.Id, key, tc.reserved, tc.actual, opID+":settle")
			require.NoError(t, err)
			assert.Equal(t, tc.charged, charged)
			var stored Token
			require.NoError(t, db.First(&stored, token.Id).Error)
			assert.Equal(t, tc.charged, stored.UsedQuota)
			assert.Equal(t, 1_000-tc.charged, stored.RemainQuota)
			if tc.disabled || tc.rotate {
				assert.Equal(t, common.TokenStatusDisabled, stored.Status)
			}
			// Later top-ups must not turn a replayed shortage into another debit.
			require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).
				Update("remain_quota", gorm.Expr("remain_quota + ?", 50)).Error)
			replayed, err := SettleResellerTokenQuota(token.Id, key, tc.reserved, tc.actual, opID+":settle")
			require.NoError(t, err)
			assert.Equal(t, charged, replayed)
			require.NoError(t, db.First(&stored, token.Id).Error)
			assert.Equal(t, 1_050-tc.charged, stored.RemainQuota)
			assert.Equal(t, tc.charged, stored.UsedQuota)
			_, err = SettleResellerTokenQuota(token.Id, key, tc.reserved, tc.actual+1, opID+":settle")
			assert.ErrorIs(t, err, ErrResellerQuotaOperationConflict)
			var ledger struct{ Adjustment int }
			require.NoError(t, db.Model(&ResellerQuotaOperation{}).Select("COALESCE(SUM(adjustment), 0) AS adjustment").
				Where("token_id = ?", token.Id).Scan(&ledger).Error)
			assert.Equal(t, -tc.charged, ledger.Adjustment, "ledger must match the durable charge")
			var operations int64
			require.NoError(t, db.Model(&ResellerQuotaOperation{}).Where("token_id = ?", token.Id).Count(&operations).Error)
			assert.EqualValues(t, 2, operations, "zero-delta settlements also need a replay marker")
			if tc.disabled {
				assert.ErrorIs(t, ReserveResellerTokenQuota(token.Id, key, 1, opID+":new"), ErrResellerTokenQuotaInsufficient)
				require.NoError(t, ReserveResellerTokenQuota(token.Id, key, tc.reserved, opID+":reserve"), "a committed reservation replay stays successful")
			}
		})
	}

	t.Run("concurrent requests and disabled in-flight refund", func(t *testing.T) {
		key := "rsl_concurrent_" + suffix
		token := Token{UserId: user.Id, Key: key, Status: common.TokenStatusEnabled,
			ExpiredTime: -1, QuotaMode: TokenQuotaModeTokens, RemainQuota: 1_000}
		require.NoError(t, db.Create(&token).Error)
		start := make(chan struct{})
		results := make(chan error, 2)
		for i := range 2 {
			go func(index int) {
				<-start
				results <- ReserveResellerTokenQuota(token.Id, key, 600, suffix+":parallel:"+strconv.Itoa(index))
			}(i)
		}
		close(start)
		first, second := <-results, <-results
		assert.True(t, (first == nil) != (second == nil), "only one reservation can fit")
		if first != nil {
			assert.ErrorIs(t, first, ErrResellerTokenQuotaInsufficient)
		}
		if second != nil {
			assert.ErrorIs(t, second, ErrResellerTokenQuotaInsufficient)
		}
		require.NoError(t, ReserveResellerTokenQuota(token.Id, key, 300, suffix+":other-in-flight"))
		charged, err := SettleResellerTokenQuota(token.Id, key, 600, 900, suffix+":shortage")
		require.NoError(t, err)
		assert.Equal(t, 700, charged)
		charged, err = SettleResellerTokenQuota(token.Id, key, 300, 100, suffix+":in-flight-refund")
		require.NoError(t, err)
		assert.Equal(t, 100, charged)
		var stored Token
		require.NoError(t, db.First(&stored, token.Id).Error)
		assert.Equal(t, 200, stored.RemainQuota)
		assert.Equal(t, 800, stored.UsedQuota)
		assert.Equal(t, common.TokenStatusDisabled, stored.Status, "refunds must not silently re-enable an unfunded key")
		assert.ErrorIs(t, ReserveResellerTokenQuota(token.Id, key, 1, suffix+":after-refund"), ErrResellerTokenQuotaInsufficient)
	})
	assert.Equal(t, 1_000, getUserQuotaFromDB(t, user.Id), "reseller request settlement must not debit the wallet")
}

func TestResellerRequestSettlementSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:reseller-request-settlement?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testResellerRequestSettlement(t, db, common.DatabaseTypeSQLite)
}

func TestResellerRequestSettlementMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testResellerRequestSettlement(t, db, common.DatabaseTypeMySQL)
}

func TestResellerRequestSettlementPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testResellerRequestSettlement(t, db, common.DatabaseTypePostgreSQL)
}

func TestResellerTokenDeleteMethodRemovesKeyWithoutRefund(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)

	require.NoError(t, token.Delete())
	assert.ErrorIs(t, DB.First(&Token{}, token.Id).Error, gorm.ErrRecordNotFound)
	assert.ErrorIs(t, DB.Where("token_id = ?", token.Id).First(&ResellerKey{}).Error, gorm.ErrRecordNotFound)
	assert.Equal(t, 900, getUserQuotaFromDB(t, user.Id), "deleting a purchased key must not refund its quota")
}

func testManualResellerQuotaAdjustment(t *testing.T, db *gorm.DB, databaseType common.DatabaseType) {
	t.Helper()
	previousDB := DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousQuotaPerUnit := common.QuotaPerUnit
	previousRedisEnabled := common.RedisEnabled
	DB = db
	common.SetDatabaseTypes(databaseType, previousLogDatabaseType)
	common.QuotaPerUnit = 500_000
	common.RedisEnabled = false
	initCol()
	defer func() {
		DB = previousDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.QuotaPerUnit = previousQuotaPerUnit
		common.RedisEnabled = previousRedisEnabled
		initCol()
	}()

	require.NoError(t, db.AutoMigrate(
		&User{}, &Token{}, &ResellerKey{}, &ResellerSubscription{}, &ResellerQuotaOperation{},
	))
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	username := "manual-reseller-quota-" + suffix
	key := "rsl_manual_" + suffix
	user := User{
		Username: username, Password: "unused", Status: common.UserStatusEnabled,
		Role: common.RoleCommonUser, Group: "default", Quota: 1_000_000,
	}
	require.NoError(t, db.Create(&user).Error)
	now := common.GetTimestamp()
	subscription := ResellerSubscription{
		UserId: user.Id, Status: ResellerSubscriptionStatusActive,
		StartTime: now - 1, EndTime: now + 24*60*60,
		ListPrice: "10.00", PaidPrice: "10.00", ChargedQuota: 5_000_000,
		DurationDays: 30, RequestId: "manual-quota-subscription-" + suffix, CreatedTime: now,
	}
	require.NoError(t, db.Create(&subscription).Error)
	token := Token{
		UserId: user.Id, Key: key, Name: "manual quota", Status: common.TokenStatusEnabled,
		CreatedTime: now, AccessedTime: now, ExpiredTime: -1,
		RemainQuota: 6_000_000, UsedQuota: 4_000_000, QuotaMode: TokenQuotaModeTokens,
		UnlimitedQuota: false, Group: "default",
	}
	require.NoError(t, db.Create(&token).Error)
	metadata := ResellerKey{
		TokenId: token.Id, UserId: user.Id, TokenMillions: 10, MarkupPercent: 20,
		BaseCostPerMillion: "0.12", Endpoint: "https://pugshop.ru/v1", CreatedTime: now,
	}
	require.NoError(t, db.Create(&metadata).Error)
	defer func() {
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&ResellerQuotaOperation{}).Error)
		require.NoError(t, db.Where("id = ?", metadata.Id).Delete(&ResellerKey{}).Error)
		require.NoError(t, db.Where("id = ?", subscription.Id).Delete(&ResellerSubscription{}).Error)
		require.NoError(t, db.Unscoped().Where("id = ?", token.Id).Delete(&Token{}).Error)
		require.NoError(t, db.Where("id = ?", user.Id).Delete(&User{}).Error)
	}()

	addRequestID := "manual-quota-add-" + suffix
	record, applied, err := AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 10, addRequestID, true,
	)
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 12, record.Metadata.TokenMillions)
	assert.Equal(t, 8_000_000, record.Token.RemainQuota)
	assert.Equal(t, 4_000_000, record.Token.UsedQuota)
	assert.Equal(t, 880_000, getUserQuotaFromDB(t, user.Id), "two million tokens cost 0.24 USD at the saved rate")

	record, applied, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSet, 14, 12, "manual-quota-set-up-"+suffix, true,
	)
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 14, record.Metadata.TokenMillions)
	assert.Equal(t, 10_000_000, record.Token.RemainQuota)
	assert.Equal(t, 4_000_000, record.Token.UsedQuota)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "setting a higher total charges only the upward delta")

	require.NoError(t, db.Model(&ResellerSubscription{}).Where("id = ?", subscription.Id).
		Update("end_time", now-1).Error)
	subtractRequestID := "manual-quota-subtract-" + suffix
	record, applied, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSubtract, 5, 14, subtractRequestID, false,
	)
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 9, record.Metadata.TokenMillions)
	assert.Equal(t, 5_000_000, record.Token.RemainQuota)
	assert.Equal(t, 4_000_000, record.Token.UsedQuota)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "removing unused quota never refunds the wallet")

	replay, applied, err := AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 10, addRequestID, false,
	)
	require.NoError(t, err)
	assert.False(t, applied)
	assert.Equal(t, 9, replay.Metadata.TokenMillions, "a late replay returns the current allocation")
	assert.Equal(t, 5_000_000, replay.Token.RemainQuota)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "an idempotent replay must not debit the wallet")

	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 1, 10, addRequestID, true,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaOperationConflict)
	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 9, addRequestID, true,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaOperationConflict)
	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 1, 9, "manual-quota-no-purchase-"+suffix, false,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaPurchaseRequired)
	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 1, 9, "manual-quota-expired-subscription-"+suffix, true,
	)
	assert.ErrorIs(t, err, ErrResellerSubscriptionRequired)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "a rejected purchase must leave the wallet unchanged")

	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSet, 7, 8, "manual-quota-stale-set-"+suffix, false,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaStateConflict)
	storedAfterStale := getTokenFromDB(t, token.Id)
	assert.Equal(t, 5_000_000, storedAfterStale.RemainQuota)
	assert.Equal(t, 4_000_000, storedAfterStale.UsedQuota)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "a stale set must not change the wallet")

	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Update("expired_time", now-1).Error)
	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 1, 9, "manual-quota-expired-key-"+suffix, true,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaKeyExpired)
	storedAfterExpiredTopUp := getTokenFromDB(t, token.Id)
	assert.Equal(t, 5_000_000, storedAfterExpiredTopUp.RemainQuota)
	assert.Equal(t, 4_000_000, storedAfterExpiredTopUp.UsedQuota)
	var metadataAfterExpiredTopUp ResellerKey
	require.NoError(t, db.Where("id = ?", metadata.Id).First(&metadataAfterExpiredTopUp).Error)
	assert.Equal(t, 9, metadataAfterExpiredTopUp.TokenMillions)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id), "an expired-key top-up must roll back every paid mutation")

	replay, applied, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 10, addRequestID, false,
	)
	require.NoError(t, err)
	assert.False(t, applied)
	assert.Equal(t, 9, replay.Metadata.TokenMillions, "an exact replay remains available after key expiration")

	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSet, 0, 9, "manual-quota-set-zero-"+suffix, false,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaAdjustmentInvalid)
	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSubtract, 9, 9, "manual-quota-subtract-zero-"+suffix, false,
	)
	assert.ErrorIs(t, err, ErrResellerQuotaAllocationOutOfRange)

	record, applied, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSet, 6, 9, "manual-quota-set-"+suffix, false,
	)
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 6, record.Metadata.TokenMillions)
	assert.Equal(t, 2_000_000, record.Token.RemainQuota)
	assert.Equal(t, 4_000_000, record.Token.UsedQuota)
	assert.Equal(t, 760_000, getUserQuotaFromDB(t, user.Id))

	_, _, err = AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentSubtract, 3, 6, "manual-quota-below-used-"+suffix, false,
	)
	assert.ErrorIs(t, err, ErrResellerTokenQuotaInsufficient)
	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, 2_000_000, stored.RemainQuota)
	assert.Equal(t, 4_000_000, stored.UsedQuota)
	var storedMetadata ResellerKey
	require.NoError(t, db.Where("id = ?", metadata.Id).First(&storedMetadata).Error)
	assert.Equal(t, 6, storedMetadata.TokenMillions)
	var operationCount int64
	require.NoError(t, db.Model(&ResellerQuotaOperation{}).Where("user_id = ?", user.Id).Count(&operationCount).Error)
	assert.EqualValues(t, 4, operationCount)
}

func TestAdjustResellerTokenQuotaReplayReconcilesCaches(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	redisServer := useUserCacheMiniRedis(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })

	user := createReserveTestUser(t, 1_000_000)
	token, metadata := newResellerPurchase(t, user.Id, 10)
	token.QuotaMode = TokenQuotaModeTokens
	token.RemainQuota = 6_000_000
	token.UsedQuota = 4_000_000
	require.NoError(t, DB.Create(&token).Error)
	metadata.TokenId = token.Id
	require.NoError(t, DB.Create(&metadata).Error)

	cachePublishResult := -1
	var cachePublishErr error
	callbackName := "test:reseller-quota-cache-fence"
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
		if cachePublishResult != -1 || tx.Statement.Schema == nil || tx.Statement.Schema.Name != "Token" {
			return
		}
		cachePublishResult, cachePublishErr = cacheInitToken(token)
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Update().Remove(callbackName)) })

	requestID := "quota-cache-replay"
	_, applied, err := AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 10, requestID, true,
	)
	require.NoError(t, err)
	require.True(t, applied)
	require.NoError(t, cachePublishErr)
	assert.Zero(t, cachePublishResult, "the mutation fence must block a stale snapshot before the token update")

	// Recreate stale snapshots after the first mutation's fence expires. A retry
	// must evict both even though its durable operation is already complete.
	redisServer.FastForward(time.Duration(tokenCacheFenceSeconds+1) * time.Second)
	cacheResult, err := cacheInitToken(token)
	require.NoError(t, err)
	require.Equal(t, 1, cacheResult)
	require.NoError(t, populateUserCache(user))

	replayed, applied, err := AdjustResellerTokenQuota(
		token.Id, user.Id, ResellerQuotaAdjustmentAdd, 2, 10, requestID, false,
	)
	require.NoError(t, err)
	assert.False(t, applied)
	assert.Equal(t, 12, replayed.Metadata.TokenMillions)
	_, err = cacheGetTokenByKey(token.Key)
	assert.Error(t, err, "an idempotent replay must evict a stale token snapshot")
	_, err = cacheGetUserBase(user.Id)
	assert.Error(t, err, "a paid idempotent replay must evict a stale wallet snapshot")
}

func testResellerKeyMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	tableName := fmt.Sprintf("reseller_key_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })
	tableDB := db.Table(tableName)

	for range 2 {
		require.NoError(t, tableDB.AutoMigrate(&ResellerKey{}))
	}
	original := ResellerKey{
		TokenId: 42, UserId: 7, TokenMillions: 50, MarkupPercent: 80,
		BaseCostPerMillion: "0.12345678", Endpoint: "https://pugshop.ru/v1", CreatedTime: 123,
	}
	require.NoError(t, tableDB.Create(&original).Error)
	require.NoError(t, tableDB.AutoMigrate(&ResellerKey{}))
	var stored ResellerKey
	require.NoError(t, tableDB.First(&stored, original.Id).Error)
	assert.Equal(t, original.BaseCostPerMillion, stored.BaseCostPerMillion)
	assert.Equal(t, original.Endpoint, stored.Endpoint)
	assert.Nil(t, stored.RequestId)
	expectedIndex := db.NamingStrategy.IndexName(tableName, "token_id")
	assert.True(t, tableDB.Migrator().HasIndex(&ResellerKey{}, expectedIndex))

	operationTableName := fmt.Sprintf("reseller_quota_operation_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(operationTableName) })
	operationDB := db.Table(operationTableName)
	for range 2 {
		require.NoError(t, operationDB.AutoMigrate(&ResellerQuotaOperation{}))
	}
	operation := ResellerQuotaOperation{
		OperationId: "migration-operation", TokenId: 42, UserId: 7,
		Adjustment: 50, CreatedTime: 123,
	}
	require.NoError(t, operationDB.Create(&operation).Error)
	require.NoError(t, operationDB.AutoMigrate(&ResellerQuotaOperation{}))
	var storedOperation ResellerQuotaOperation
	require.NoError(t, operationDB.First(&storedOperation, operation.Id).Error)
	assert.Equal(t, operation.OperationId, storedOperation.OperationId)
	assert.Equal(t, operation.Adjustment, storedOperation.Adjustment)
	operationIndex := db.NamingStrategy.IndexName(operationTableName, "operation_id")
	assert.True(t, operationDB.Migrator().HasIndex(&ResellerQuotaOperation{}, operationIndex))

	subscriptionTableName := fmt.Sprintf("reseller_subscription_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(subscriptionTableName) })
	subscriptionDB := db.Table(subscriptionTableName)
	for range 2 {
		require.NoError(t, subscriptionDB.AutoMigrate(&ResellerSubscription{}))
	}
	subscription := ResellerSubscription{
		UserId: 7, Status: ResellerSubscriptionStatusActive,
		StartTime: 100, EndTime: 200, ListPrice: "10.00", DiscountPercent: 20,
		PaidPrice: "8.00", ChargedQuota: 4_000_000, DurationDays: 30,
		RequestId: "migration-subscription", CreatedTime: 100,
	}
	require.NoError(t, subscriptionDB.Create(&subscription).Error)
	require.NoError(t, subscriptionDB.AutoMigrate(&ResellerSubscription{}))
	var storedSubscription ResellerSubscription
	require.NoError(t, subscriptionDB.First(&storedSubscription, subscription.Id).Error)
	assert.Equal(t, subscription.ListPrice, storedSubscription.ListPrice)
	assert.Equal(t, subscription.PaidPrice, storedSubscription.PaidPrice)
	// The composite request index must survive repeat migrations and preserve
	// existing subscription snapshots.
	assert.True(t, subscriptionDB.Migrator().HasIndex(&ResellerSubscription{}, "idx_reseller_subscription_request"))
}

func TestResellerKeyMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testResellerKeyMigration(t, db)
}

func TestResellerKeyMigrationMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	testResellerKeyMigration(t, db)
}

func TestResellerKeyMigrationPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	testResellerKeyMigration(t, db)
}

func TestManualResellerQuotaAdjustmentSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:manual-reseller-quota?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	testManualResellerQuotaAdjustment(t, db, common.DatabaseTypeSQLite)
}

func TestManualResellerQuotaAdjustmentMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testManualResellerQuotaAdjustment(t, db, common.DatabaseTypeMySQL)
}

func TestManualResellerQuotaAdjustmentPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testManualResellerQuotaAdjustment(t, db, common.DatabaseTypePostgreSQL)
}

func TestUpdateOptionRejectsNonCanonicalResellerValues(t *testing.T) {
	truncateTables(t)
	require.Error(t, UpdateOption("reseller_setting.base_cost_per_million", " 0.12"))
	require.Error(t, UpdateOption("reseller_setting.endpoint", "https://pugshop.ru "))
	var count int64
	require.NoError(t, DB.Model(&Option{}).Where("key IN (?)", []string{
		"reseller_setting.base_cost_per_million",
		"reseller_setting.endpoint",
	}).Count(&count).Error)
	assert.Zero(t, count)
}
