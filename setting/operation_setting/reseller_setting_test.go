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
package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseResellerSettingOptionsBuildsCompleteValidatedSnapshot(t *testing.T) {
	defaults := DefaultResellerSetting()
	settings, err := ParseResellerSettingOptions(map[string]string{
		ResellerEndpointOption:                 "https://reseller.example/v1",
		ResellerSubscriptionDiscountOption:     "25",
		ResellerSubscriptionDurationDaysOption: "90",
	})
	require.NoError(t, err)
	assert.Equal(t, ResellerSetting{
		BaseCostPerMillion:          defaults.BaseCostPerMillion,
		Endpoint:                    "https://reseller.example/v1",
		SubscriptionPrice:           defaults.SubscriptionPrice,
		SubscriptionDiscountPercent: 25,
		SubscriptionDurationDays:    90,
	}, settings)

	_, err = ParseResellerSettingOptions(map[string]string{
		ResellerBaseCostPerMillionOption:       "0.75",
		ResellerSubscriptionDurationDaysOption: "0",
	})
	require.Error(t, err)
}

func TestValidateResellerBaseCost(t *testing.T) {
	for _, value := range []string{"0.01", "0.12", "1", "999999.99", "1000000"} {
		assert.NoError(t, ValidateResellerBaseCost(value), value)
	}
	for _, value := range []string{"", "0", "0.001", "0.009", "0.011", "-1", "NaN", "+Inf", "1000000.01", "1000001", " 0.12", "0.12 "} {
		assert.Error(t, ValidateResellerBaseCost(value), value)
	}
}

func TestValidateResellerEndpoint(t *testing.T) {
	for _, value := range []string{"https://pugshop.ru/v1", "http://localhost:3000/v1"} {
		assert.NoError(t, ValidateResellerEndpoint(value), value)
	}
	for _, value := range []string{
		"",
		"pugshop.ru",
		"ftp://pugshop.ru",
		"https://user:pass@pugshop.ru",
		"https://pugshop.ru?key=value",
		"https://pugshop.ru/#fragment",
		"https://pugshop.ru\\evil",
		"https://pugshop.ru/path with spaces",
		" https://pugshop.ru",
		"https://pugshop.ru ",
	} {
		assert.Error(t, ValidateResellerEndpoint(value), value)
	}
}

func TestValidateResellerSubscriptionSettings(t *testing.T) {
	for _, value := range []string{"0.01", "10", "999999.99", "1000000"} {
		assert.NoError(t, ValidateResellerSubscriptionPrice(value), value)
	}
	for _, value := range []string{"", "0", "0.001", "0.011", "1000000.01", "NaN", "+Inf", " 10"} {
		assert.Error(t, ValidateResellerSubscriptionPrice(value), value)
	}
	for _, value := range []string{"0", "20", "90"} {
		assert.NoError(t, ValidateResellerSubscriptionDiscountPercent(value), value)
	}
	for _, value := range []string{"-1", "91", "1.5", "+1", " 20"} {
		assert.Error(t, ValidateResellerSubscriptionDiscountPercent(value), value)
	}
	for _, value := range []string{"1", "30", "3650"} {
		assert.NoError(t, ValidateResellerSubscriptionDurationDays(value), value)
	}
	for _, value := range []string{"0", "3651", "30.5", "+30", " 30"} {
		assert.Error(t, ValidateResellerSubscriptionDurationDays(value), value)
	}
}
