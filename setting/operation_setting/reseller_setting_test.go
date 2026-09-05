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
)

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
