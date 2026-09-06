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
	"errors"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/shopspring/decimal"
)

const (
	ResellerBaseCostPerMillionOption       = "reseller_setting.base_cost_per_million"
	ResellerEndpointOption                 = "reseller_setting.endpoint"
	ResellerSubscriptionPriceOption        = "reseller_setting.subscription_price"
	ResellerSubscriptionDiscountOption     = "reseller_setting.subscription_discount_percent"
	ResellerSubscriptionDurationDaysOption = "reseller_setting.subscription_duration_days"
	ResellerSubscriptionMinPrice           = 0.01
	ResellerSubscriptionMaxPrice           = 1_000_000
	ResellerSubscriptionMaxDiscountPercent = 90
	ResellerSubscriptionMinDurationDays    = 1
	ResellerSubscriptionMaxDurationDays    = 3650
)

type ResellerSetting struct {
	BaseCostPerMillion          float64 `json:"base_cost_per_million"`
	Endpoint                    string  `json:"endpoint"`
	SubscriptionPrice           float64 `json:"subscription_price"`
	SubscriptionDiscountPercent int     `json:"subscription_discount_percent"`
	SubscriptionDurationDays    int     `json:"subscription_duration_days"`
}

var defaultResellerSetting = ResellerSetting{
	BaseCostPerMillion:          0.12,
	Endpoint:                    "https://pugshop.ru/v1",
	SubscriptionPrice:           10,
	SubscriptionDiscountPercent: 0,
	SubscriptionDurationDays:    30,
}

var resellerSetting = defaultResellerSetting

var resellerSettingMutex sync.RWMutex

func init() {
	config.GlobalConfig.Register("reseller_setting", &resellerSetting)
}

func GetResellerSetting() ResellerSetting {
	resellerSettingMutex.RLock()
	defer resellerSettingMutex.RUnlock()
	return resellerSetting
}

func DefaultResellerSetting() ResellerSetting {
	return defaultResellerSetting
}

func SetResellerSetting(settings ResellerSetting) {
	resellerSettingMutex.Lock()
	resellerSetting = settings
	resellerSettingMutex.Unlock()
}

func UpdateResellerSettingOption(key string, value string) (bool, error) {
	resellerSettingMutex.Lock()
	defer resellerSettingMutex.Unlock()
	return applyResellerSettingOption(&resellerSetting, key, value)
}

func IsResellerSettingOption(key string) bool {
	switch key {
	case ResellerBaseCostPerMillionOption,
		ResellerEndpointOption,
		ResellerSubscriptionPriceOption,
		ResellerSubscriptionDiscountOption,
		ResellerSubscriptionDurationDaysOption:
		return true
	default:
		return false
	}
}

// ParseResellerSettingOptions builds a complete snapshot from persisted
// options. Missing options retain their product defaults, while any invalid
// persisted value rejects the entire snapshot.
func ParseResellerSettingOptions(values map[string]string) (ResellerSetting, error) {
	settings := defaultResellerSetting
	for _, key := range []string{
		ResellerBaseCostPerMillionOption,
		ResellerEndpointOption,
		ResellerSubscriptionPriceOption,
		ResellerSubscriptionDiscountOption,
		ResellerSubscriptionDurationDaysOption,
	} {
		value, ok := values[key]
		if !ok {
			continue
		}
		if _, err := applyResellerSettingOption(&settings, key, value); err != nil {
			return ResellerSetting{}, err
		}
	}
	return settings, nil
}

func applyResellerSettingOption(settings *ResellerSetting, key string, value string) (bool, error) {
	switch key {
	case ResellerBaseCostPerMillionOption:
		if err := ValidateResellerBaseCost(value); err != nil {
			return true, err
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return true, err
		}
		settings.BaseCostPerMillion = parsed
	case ResellerEndpointOption:
		if err := ValidateResellerEndpoint(value); err != nil {
			return true, err
		}
		settings.Endpoint = value
	case ResellerSubscriptionPriceOption:
		if err := ValidateResellerSubscriptionPrice(value); err != nil {
			return true, err
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return true, err
		}
		settings.SubscriptionPrice = parsed
	case ResellerSubscriptionDiscountOption:
		if err := ValidateResellerSubscriptionDiscountPercent(value); err != nil {
			return true, err
		}
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return true, err
		}
		settings.SubscriptionDiscountPercent = parsed
	case ResellerSubscriptionDurationDaysOption:
		if err := ValidateResellerSubscriptionDurationDays(value); err != nil {
			return true, err
		}
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return true, err
		}
		settings.SubscriptionDurationDays = parsed
	default:
		return false, nil
	}
	return true, nil
}

func ValidateResellerBaseCost(value string) error {
	if value != strings.TrimSpace(value) {
		return errors.New("reseller base cost cannot contain surrounding whitespace")
	}
	cost, err := decimal.NewFromString(value)
	if err != nil || cost.LessThan(decimal.NewFromFloat(0.01)) || cost.GreaterThan(decimal.NewFromInt(1_000_000)) {
		return errors.New("reseller base cost must be between 0.01 and 1000000")
	}
	if cost.Exponent() < -2 {
		return errors.New("reseller base cost cannot have more than two decimal places")
	}
	return nil
}

func ValidateResellerEndpoint(value string) error {
	endpoint := strings.TrimSpace(value)
	if endpoint != value {
		return errors.New("reseller endpoint cannot contain surrounding whitespace")
	}
	if endpoint == "" || strings.Contains(endpoint, "\\") {
		return errors.New("reseller endpoint must be a valid HTTP(S) URL")
	}
	for _, character := range endpoint {
		if character <= 0x20 {
			return errors.New("reseller endpoint must be a valid HTTP(S) URL")
		}
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Hostname() == "" {
		return errors.New("reseller endpoint must be a valid HTTP(S) URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("reseller endpoint must use HTTP or HTTPS")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("reseller endpoint cannot contain credentials, a query, or a fragment")
	}
	return nil
}

func ValidateResellerSubscriptionPrice(value string) error {
	if value != strings.TrimSpace(value) {
		return errors.New("reseller subscription price cannot contain surrounding whitespace")
	}
	price, err := decimal.NewFromString(value)
	if err != nil || price.LessThan(decimal.NewFromFloat(ResellerSubscriptionMinPrice)) || price.GreaterThan(decimal.NewFromInt(ResellerSubscriptionMaxPrice)) {
		return errors.New("reseller subscription price must be between 0.01 and 1000000")
	}
	if price.Exponent() < -2 {
		return errors.New("reseller subscription price cannot have more than two decimal places")
	}
	return nil
}

func ValidateResellerSubscriptionDiscountPercent(value string) error {
	if value != strings.TrimSpace(value) {
		return errors.New("reseller subscription discount cannot contain surrounding whitespace")
	}
	discount, err := strconv.Atoi(value)
	if err != nil || strconv.Itoa(discount) != value || discount < 0 || discount > ResellerSubscriptionMaxDiscountPercent {
		return errors.New("reseller subscription discount must be an integer between 0 and 90")
	}
	return nil
}

func ValidateResellerSubscriptionDurationDays(value string) error {
	if value != strings.TrimSpace(value) {
		return errors.New("reseller subscription duration cannot contain surrounding whitespace")
	}
	days, err := strconv.Atoi(value)
	if err != nil || strconv.Itoa(days) != value || days < ResellerSubscriptionMinDurationDays || days > ResellerSubscriptionMaxDurationDays {
		return errors.New("reseller subscription duration must be an integer between 1 and 3650 days")
	}
	return nil
}
