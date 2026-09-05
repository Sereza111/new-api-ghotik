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
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/shopspring/decimal"
)

const (
	ResellerBaseCostPerMillionOption = "reseller_setting.base_cost_per_million"
	ResellerEndpointOption           = "reseller_setting.endpoint"
)

type ResellerSetting struct {
	BaseCostPerMillion float64 `json:"base_cost_per_million"`
	Endpoint           string  `json:"endpoint"`
}

var resellerSetting = ResellerSetting{
	BaseCostPerMillion: 0.12,
	Endpoint:           "https://pugshop.ru/v1",
}

func init() {
	config.GlobalConfig.Register("reseller_setting", &resellerSetting)
}

func GetResellerSetting() ResellerSetting {
	return resellerSetting
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
