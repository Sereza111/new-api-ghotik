package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateResellerCommercialSettingsCommitsCompleteTuple(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	restoreResellerSettingsAfterTest(t)

	context, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/option/reseller", map[string]any{
		"base_cost_per_million":         0.25,
		"endpoint":                      "https://reseller.example/v1",
		"subscription_price":            19.99,
		"subscription_discount_percent": 15,
		"subscription_duration_days":    45,
	}, 1)
	UpdateResellerCommercialSettings(context)

	response := decodeAPIResponse(t, recorder)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, response.Success, response.Message)
	assert.Equal(t, operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.25,
		Endpoint:                    "https://reseller.example/v1",
		SubscriptionPrice:           19.99,
		SubscriptionDiscountPercent: 15,
		SubscriptionDurationDays:    45,
	}, operation_setting.GetResellerSetting())

	want := map[string]string{
		operation_setting.ResellerBaseCostPerMillionOption:       "0.25",
		operation_setting.ResellerEndpointOption:                 "https://reseller.example/v1",
		operation_setting.ResellerSubscriptionPriceOption:        "19.99",
		operation_setting.ResellerSubscriptionDiscountOption:     "15",
		operation_setting.ResellerSubscriptionDurationDaysOption: "45",
	}
	for key, value := range want {
		var option model.Option
		require.NoError(t, db.First(&option, "key = ?", key).Error)
		assert.Equal(t, value, option.Value, key)
	}
}

func TestUpdateResellerCommercialSettingsRejectsWholeInvalidTuple(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	restoreResellerSettingsAfterTest(t)

	baselineSettings := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, model.UpdateResellerCommercialSettings(baselineSettings))
	baseline := map[string]string{
		operation_setting.ResellerBaseCostPerMillionOption:       "0.12",
		operation_setting.ResellerEndpointOption:                 "https://before.example/v1",
		operation_setting.ResellerSubscriptionPriceOption:        "10",
		operation_setting.ResellerSubscriptionDiscountOption:     "5",
		operation_setting.ResellerSubscriptionDurationDaysOption: "30",
	}

	context, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/option/reseller", map[string]any{
		"base_cost_per_million":         0.99,
		"endpoint":                      "https://after.example/v1",
		"subscription_price":            49.99,
		"subscription_discount_percent": 25,
		"subscription_duration_days":    0,
	}, 1)
	UpdateResellerCommercialSettings(context)

	response := decodeAPIResponse(t, recorder)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "duration")
	assert.Equal(t, baselineSettings, operation_setting.GetResellerSetting())

	for key, value := range baseline {
		var option model.Option
		require.NoError(t, db.First(&option, "key = ?", key).Error)
		assert.Equal(t, value, option.Value, key)
	}
}

func TestUpdateOptionRejectsIndividualResellerCommercialSetting(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	restoreResellerSettingsAfterTest(t)
	baseline := operation_setting.ResellerSetting{
		BaseCostPerMillion:          0.12,
		Endpoint:                    "https://before.example/v1",
		SubscriptionPrice:           10,
		SubscriptionDiscountPercent: 5,
		SubscriptionDurationDays:    30,
	}
	require.NoError(t, model.UpdateResellerCommercialSettings(baseline))

	context, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/option/", OptionUpdateRequest{
		Key:   operation_setting.ResellerSubscriptionPriceOption,
		Value: "99.99",
	}, 1)
	UpdateOption(context)

	response := decodeAPIResponse(t, recorder)
	assert.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "/api/option/reseller")
	assert.Equal(t, baseline, operation_setting.GetResellerSetting())
	var stored model.Option
	require.NoError(t, db.First(&stored, "key = ?", operation_setting.ResellerSubscriptionPriceOption).Error)
	assert.Equal(t, "10", stored.Value)
}

func restoreResellerSettingsAfterTest(t *testing.T) {
	t.Helper()
	original := operation_setting.GetResellerSetting()
	common.OptionMapRWMutex.Lock()
	originalMap := common.OptionMap
	testMap := make(map[string]string, len(originalMap))
	for key, value := range originalMap {
		testMap[key] = value
	}
	common.OptionMap = testMap
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		operation_setting.SetResellerSetting(original)
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalMap
		common.OptionMapRWMutex.Unlock()
	})
}
