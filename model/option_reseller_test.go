package model

import (
	"errors"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLoadOptionsFromDatabasePublishesOnlyCompleteValidResellerSnapshot(t *testing.T) {
	previousDB := DB
	previousMap := common.OptionMap
	originalSettings := operation_setting.GetResellerSetting()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		operation_setting.SetResellerSetting(originalSettings)
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousMap
		common.OptionMapRWMutex.Unlock()
	})

	baseline := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, UpdateResellerCommercialSettings(baseline))

	after := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.75,
		Endpoint:                    "https://after.example/v1",
		SubscriptionPrice:           49.99,
		SubscriptionDiscountPercent: 25,
		SubscriptionDurationDays:    90,
	}
	afterValues := resellerCommercialOptionValues(after)
	afterValues[operation_setting.ResellerSubscriptionDurationDaysOption] = "0"
	for key, value := range afterValues {
		require.NoError(t, db.Model(&Option{}).Where("key = ?", key).Update("value", value).Error)
	}

	loadOptionsFromDatabase()
	assert.Equal(t, baseline, operation_setting.GetResellerSetting())
	common.OptionMapRWMutex.RLock()
	for key, value := range resellerCommercialOptionValues(baseline) {
		assert.Equal(t, value, common.OptionMap[key], key)
	}
	common.OptionMapRWMutex.RUnlock()

	require.NoError(t, db.Model(&Option{}).
		Where("key = ?", operation_setting.ResellerSubscriptionDurationDaysOption).
		Update("value", strconv.Itoa(after.SubscriptionDurationDays)).Error)
	loadOptionsFromDatabase()
	assert.Equal(t, after, operation_setting.GetResellerSetting())

	require.NoError(t, db.Delete(&Option{}, "key = ?", operation_setting.ResellerEndpointOption).Error)
	loadOptionsFromDatabase()
	defaulted := after
	defaulted.Endpoint = operation_setting.DefaultResellerSetting().Endpoint
	assert.Equal(t, defaulted, operation_setting.GetResellerSetting())
	common.OptionMapRWMutex.RLock()
	assert.Equal(t, defaulted.Endpoint, common.OptionMap[operation_setting.ResellerEndpointOption])
	common.OptionMapRWMutex.RUnlock()
}

func TestUpdateResellerCommercialSettingsRejectsInvalidTupleWithoutPartialWrites(t *testing.T) {
	previousDB := DB
	previousMap := common.OptionMap
	originalSettings := operation_setting.GetResellerSetting()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		operation_setting.SetResellerSetting(originalSettings)
		DB = previousDB
		common.OptionMap = previousMap
	})

	baselineSettings := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, UpdateResellerCommercialSettings(baselineSettings))

	invalidSettings := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.99,
		Endpoint:                    "https://after.example/v1",
		SubscriptionPrice:           49.99,
		SubscriptionDiscountPercent: 25,
		SubscriptionDurationDays:    0,
	}
	require.Error(t, UpdateResellerCommercialSettings(invalidSettings))

	baseline := map[string]string{
		operation_setting.ResellerBaseCostPerMillionOption:       "0.12",
		operation_setting.ResellerEndpointOption:                 "https://before.example/v1",
		operation_setting.ResellerSubscriptionPriceOption:        "10",
		operation_setting.ResellerSubscriptionDiscountOption:     "5",
		operation_setting.ResellerSubscriptionDurationDaysOption: "30",
	}
	for key, value := range baseline {
		var option Option
		require.NoError(t, db.First(&option, "key = ?", key).Error)
		assert.Equal(t, value, option.Value, key)
		assert.Equal(t, value, common.OptionMap[key], key)
	}
	assert.Equal(t, baselineSettings, operation_setting.GetResellerSetting())
}

func TestUpdateResellerCommercialSettingsRollsBackDatabaseFailure(t *testing.T) {
	previousDB := DB
	previousMap := common.OptionMap
	originalSettings := operation_setting.GetResellerSetting()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		operation_setting.SetResellerSetting(originalSettings)
		DB = previousDB
		common.OptionMap = previousMap
	})

	baselineSettings := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, UpdateResellerCommercialSettings(baselineSettings))

	forcedFailure := errors.New("forced reseller option write failure")
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register("test:fail_reseller_option_update", func(tx *gorm.DB) {
		option, ok := tx.Statement.Dest.(*Option)
		if ok && option.Key == operation_setting.ResellerSubscriptionPriceOption {
			tx.AddError(forcedFailure)
		}
	}))
	t.Cleanup(func() {
		require.NoError(t, db.Callback().Update().Remove("test:fail_reseller_option_update"))
	})

	err = UpdateResellerCommercialSettings(operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.99,
		Endpoint:                    "https://after.example/v1",
		SubscriptionPrice:           49.99,
		SubscriptionDiscountPercent: 25,
		SubscriptionDurationDays:    60,
	})
	require.ErrorIs(t, err, forcedFailure)

	baseline := map[string]string{
		operation_setting.ResellerBaseCostPerMillionOption:       "0.12",
		operation_setting.ResellerEndpointOption:                 "https://before.example/v1",
		operation_setting.ResellerSubscriptionPriceOption:        "10",
		operation_setting.ResellerSubscriptionDiscountOption:     "5",
		operation_setting.ResellerSubscriptionDurationDaysOption: "30",
	}
	for key, value := range baseline {
		var option Option
		require.NoError(t, db.First(&option, "key = ?", key).Error)
		assert.Equal(t, value, option.Value, key)
		assert.Equal(t, value, common.OptionMap[key], key)
	}
	assert.Equal(t, baselineSettings, operation_setting.GetResellerSetting())
}
