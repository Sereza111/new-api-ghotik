package model

import (
	"fmt"
	"os"
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
	key, err := NewResellerTokenKey()
	require.NoError(t, err)
	now := common.GetTimestamp()
	return Token{
			UserId: userId, Key: key, Name: "client", Status: common.TokenStatusEnabled,
			CreatedTime: now, AccessedTime: now, ExpiredTime: -1,
			RemainQuota: millions * 1_000_000, UnlimitedQuota: false,
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
	require.NoError(t, stale.UpdateResellerMetadata())

	stored := getTokenFromDB(t, token.Id)
	assert.Equal(t, "renamed", stored.Name)
	assert.Equal(t, common.TokenStatusDisabled, stored.Status)
	assert.Equal(t, 700_000, stored.RemainQuota)
	assert.Equal(t, 300_000, stored.UsedQuota)
	assert.False(t, stored.UnlimitedQuota)
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

func TestResellerTokenDeleteMethodIsBlocked(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	user := createReserveTestUser(t, 1_000)
	token, metadata := newResellerPurchase(t, user.Id, 1)
	created, err := CreatePrepaidResellerToken(&token, &metadata, 100)
	require.NoError(t, err)
	require.True(t, created)

	assert.ErrorIs(t, token.Delete(), ErrResellerTokenDeletionNotAllowed)
	require.NoError(t, DB.First(&Token{}, token.Id).Error)
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
