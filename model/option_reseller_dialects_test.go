package model

import (
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testUpdateResellerCommercialSettingsDialect(t *testing.T, db *gorm.DB, databaseType common.DatabaseType) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&Option{}))

	keys := []string{
		operation_setting.ResellerBaseCostPerMillionOption,
		operation_setting.ResellerEndpointOption,
		operation_setting.ResellerSubscriptionPriceOption,
		operation_setting.ResellerSubscriptionDiscountOption,
		operation_setting.ResellerSubscriptionDurationDaysOption,
	}
	require.NoError(t, db.Where(map[string]any{"key": keys}).Delete(&Option{}).Error)

	previousDB := DB
	previousDatabaseType := common.MainDatabaseType()
	common.OptionMapRWMutex.Lock()
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	previousSettings := operation_setting.GetResellerSetting()
	DB = db
	common.SetMainDatabaseType(databaseType)
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousDatabaseType)
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousMap
		common.OptionMapRWMutex.Unlock()
		operation_setting.SetResellerSetting(previousSettings)
	})

	baseline := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, UpdateResellerCommercialSettings(baseline))

	committed := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.25,
		Endpoint:                    "https://after.example/v1",
		SubscriptionPrice:           49.99,
		SubscriptionDiscountPercent: 25,
		SubscriptionDurationDays:    60,
	}
	require.NoError(t, UpdateResellerCommercialSettings(committed))

	expected := map[string]string{
		operation_setting.ResellerBaseCostPerMillionOption:       "0.25",
		operation_setting.ResellerEndpointOption:                 "https://after.example/v1",
		operation_setting.ResellerSubscriptionPriceOption:        "49.99",
		operation_setting.ResellerSubscriptionDiscountOption:     "25",
		operation_setting.ResellerSubscriptionDurationDaysOption: "60",
	}
	assertResellerCommercialSettingsState(t, db, expected, committed)

	invalid := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.99,
		Endpoint:                    "https://invalid.example/v1",
		SubscriptionPrice:           99.99,
		SubscriptionDiscountPercent: 50,
		SubscriptionDurationDays:    0,
	}
	require.Error(t, UpdateResellerCommercialSettings(invalid))
	assertResellerCommercialSettingsState(t, db, expected, committed)
}

func assertResellerCommercialSettingsState(
	t *testing.T,
	db *gorm.DB,
	expected map[string]string,
	expectedSnapshot operation_setting.ResellerSetting,
) {
	t.Helper()
	keys := make([]string, 0, len(expected))
	for key := range expected {
		keys = append(keys, key)
	}
	var options []Option
	require.NoError(t, db.Where(map[string]any{"key": keys}).Find(&options).Error)
	require.Len(t, options, len(expected))
	stored := make(map[string]string, len(options))
	for _, option := range options {
		stored[option.Key] = option.Value
	}
	assert.Equal(t, expected, stored)

	common.OptionMapRWMutex.RLock()
	inMemory := make(map[string]string, len(expected))
	for key := range expected {
		inMemory[key] = common.OptionMap[key]
	}
	common.OptionMapRWMutex.RUnlock()
	assert.Equal(t, expected, inMemory)
	assert.Equal(t, expectedSnapshot, operation_setting.GetResellerSetting())
}

func TestUpdateResellerCommercialSettingsDialectSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testUpdateResellerCommercialSettingsDialect(t, db, common.DatabaseTypeSQLite)
}

func TestUpdateResellerCommercialSettingsDialectMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	testUpdateResellerCommercialSettingsDialect(t, db, common.DatabaseTypeMySQL)
}

func TestUpdateResellerCommercialSettingsDialectPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	testUpdateResellerCommercialSettingsDialect(t, db, common.DatabaseTypePostgreSQL)
}
