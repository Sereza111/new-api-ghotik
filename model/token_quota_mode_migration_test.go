package model

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
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

type legacyTokenWithoutQuotaMode struct {
	Id                 int    `gorm:"primaryKey"`
	UserId             int    `gorm:"index"`
	Key                string `gorm:"column:key;type:varchar(128);uniqueIndex"`
	Status             int    `gorm:"default:1"`
	Name               string `gorm:"index"`
	CreatedTime        int64  `gorm:"bigint"`
	AccessedTime       int64  `gorm:"bigint"`
	ExpiredTime        int64  `gorm:"bigint;default:-1"`
	RemainQuota        int    `gorm:"default:0"`
	UnlimitedQuota     bool
	ModelLimitsEnabled bool
	ModelLimits        string  `gorm:"type:text"`
	AllowIps           *string `gorm:"default:''"`
	UsedQuota          int     `gorm:"default:0"`
	Group              string  `gorm:"column:group;default:''"`
	CrossGroupRetry    bool
	AutoGroups         string         `gorm:"type:text"`
	DeletedAt          gorm.DeletedAt `gorm:"index"`
}

func quotaModeColumnType(t *testing.T, db *gorm.DB, dialect string, tableName string) string {
	t.Helper()

	switch dialect {
	case "sqlite":
		var columns []struct {
			Name string `gorm:"column:name"`
			Type string `gorm:"column:type"`
		}
		require.NoError(t, db.Raw("PRAGMA table_info("+tableName+")").Scan(&columns).Error)
		for _, column := range columns {
			if column.Name == "quota_mode" {
				return strings.ToLower(column.Type)
			}
		}
		require.FailNow(t, "quota_mode column was not found", "table: %s", tableName)
	case "mysql":
		var columnType string
		require.NoError(t, db.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
			WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, "quota_mode").Scan(&columnType).Error)
		return strings.ToLower(columnType)
	case "postgres":
		var dataType string
		var maxLength sql.NullInt64
		require.NoError(t, db.Raw(`SELECT data_type, character_maximum_length
			FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, "quota_mode").Row().Scan(&dataType, &maxLength))
		if strings.EqualFold(dataType, "character varying") {
			return fmt.Sprintf("varchar(%d)", maxLength.Int64)
		}
		return strings.ToLower(dataType)
	default:
		require.FailNow(t, "unsupported database dialect", "dialect: %s", dialect)
	}

	return ""
}

func testTokenQuotaModeMigration(t *testing.T, db *gorm.DB, dialect string) {
	t.Helper()

	freshTable := fmt.Sprintf("token_quota_fresh_%d", time.Now().UnixNano())
	upgradeTable := fmt.Sprintf("token_quota_upgrade_%d", time.Now().UnixNano())
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(freshTable))
		require.NoError(t, db.Migrator().DropTable(upgradeTable))
	})

	freshDB := db.Table(freshTable)
	for range 2 {
		require.NoError(t, freshDB.AutoMigrate(&Token{}))
	}
	assert.Equal(t, "varchar(16)", quotaModeColumnType(t, db, dialect, freshTable))

	tokenMode := Token{
		UserId:         41,
		Key:            "token-mode-roundtrip-key",
		Name:           "token quota",
		Status:         1,
		CreatedTime:    11,
		AccessedTime:   12,
		ExpiredTime:    -1,
		RemainQuota:    1_000_000,
		UnlimitedQuota: false,
		QuotaMode:      TokenQuotaModeTokens,
		UsedQuota:      23,
		Group:          "default",
	}
	require.NoError(t, freshDB.Create(&tokenMode).Error)
	var roundTripped Token
	require.NoError(t, freshDB.First(&roundTripped, tokenMode.Id).Error)
	assert.Equal(t, TokenQuotaModeTokens, roundTripped.QuotaMode)
	assert.Equal(t, TokenQuotaModeTokens, roundTripped.EffectiveQuotaMode())
	assert.Equal(t, tokenMode.RemainQuota, roundTripped.RemainQuota)
	assert.Equal(t, tokenMode.UsedQuota, roundTripped.UsedQuota)

	upgradeDB := db.Table(upgradeTable)
	require.NoError(t, upgradeDB.AutoMigrate(&legacyTokenWithoutQuotaMode{}))
	assert.False(t, db.Migrator().HasColumn(upgradeTable, "quota_mode"))

	allowIPs := "127.0.0.1"
	legacy := legacyTokenWithoutQuotaMode{
		UserId:         42,
		Key:            "legacy-money-mode-key",
		Name:           "preserved legacy key",
		Status:         1,
		CreatedTime:    21,
		AccessedTime:   22,
		ExpiredTime:    -1,
		RemainQuota:    987_654,
		UnlimitedQuota: false,
		AllowIps:       &allowIPs,
		UsedQuota:      123_456,
		Group:          "default",
	}
	require.NoError(t, upgradeDB.Create(&legacy).Error)
	keyIndex := db.NamingStrategy.IndexName(upgradeTable, "key")
	assert.True(t, db.Migrator().HasIndex(upgradeTable, keyIndex))

	for range 2 {
		require.NoError(t, upgradeDB.AutoMigrate(&Token{}))
	}
	assert.Equal(t, "varchar(16)", quotaModeColumnType(t, db, dialect, upgradeTable))

	var migrated Token
	require.NoError(t, upgradeDB.First(&migrated, legacy.Id).Error)
	assert.Equal(t, legacy.Id, migrated.Id)
	assert.Equal(t, legacy.Key, migrated.Key)
	assert.Equal(t, legacy.Name, migrated.Name)
	assert.Equal(t, legacy.RemainQuota, migrated.RemainQuota)
	assert.Equal(t, legacy.UsedQuota, migrated.UsedQuota)
	assert.Empty(t, migrated.QuotaMode)
	assert.Equal(t, TokenQuotaModeMoney, migrated.EffectiveQuotaMode())
	assert.True(t, db.Migrator().HasIndex(upgradeTable, keyIndex))

	duplicate := legacyTokenWithoutQuotaMode{UserId: 43, Key: legacy.Key, Name: "duplicate"}
	require.Error(t, db.Table(upgradeTable).Create(&duplicate).Error)
	var rowCount int64
	require.NoError(t, db.Table(upgradeTable).Model(&Token{}).Count(&rowCount).Error)
	assert.EqualValues(t, 1, rowCount)
}

func testDeletedRawTokenQuotaTarget(t *testing.T, db *gorm.DB, databaseType common.DatabaseType) {
	t.Helper()

	previousDB := DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	DB = db
	common.SetDatabaseTypes(databaseType, previousLogDatabaseType)
	defer func() {
		DB = previousDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
	}()

	require.NoError(t, db.AutoMigrate(&Token{}, &ResellerQuotaOperation{}))
	suffix := time.Now().UnixNano()
	key := fmt.Sprintf("deleted-raw-quota-%d", suffix)
	operationID := fmt.Sprintf("deleted-raw-quota-%d:settle", suffix)
	token := Token{
		UserId:         44,
		Key:            key,
		Name:           "deleted raw quota target",
		Status:         1,
		RemainQuota:    0,
		UsedQuota:      1_000,
		QuotaMode:      TokenQuotaModeTokens,
		UnlimitedQuota: false,
	}
	require.NoError(t, db.Create(&token).Error)
	t.Cleanup(func() {
		require.NoError(t, db.Unscoped().Where("id = ?", token.Id).Delete(&Token{}).Error)
		require.NoError(t, db.Where("operation_id = ?", operationID).Delete(&ResellerQuotaOperation{}).Error)
	})
	require.NoError(t, db.Delete(&token).Error)

	err := ApplyTokenQuotaAdjustmentOnce(token.Id, key, 885, operationID)
	assert.ErrorIs(t, err, ErrTokenQuotaTargetNotFound)
	var operationCount int64
	require.NoError(t, db.Model(&ResellerQuotaOperation{}).Where("operation_id = ?", operationID).Count(&operationCount).Error)
	assert.Zero(t, operationCount)
}

func TestTokenQuotaModeMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testTokenQuotaModeMigration(t, db, "sqlite")
	testDeletedRawTokenQuotaTarget(t, db, common.DatabaseTypeSQLite)
}

func TestTokenQuotaModeMigrationMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testTokenQuotaModeMigration(t, db, "mysql")
	testDeletedRawTokenQuotaTarget(t, db, common.DatabaseTypeMySQL)
}

func TestTokenQuotaModeMigrationPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testTokenQuotaModeMigration(t, db, "postgres")
	testDeletedRawTokenQuotaTarget(t, db, common.DatabaseTypePostgreSQL)
}
