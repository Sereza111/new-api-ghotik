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
package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

type resellerCommercialSettingsRequest struct {
	BaseCostPerMillion          float64 `json:"base_cost_per_million"`
	Endpoint                    string  `json:"endpoint"`
	SubscriptionPrice           float64 `json:"subscription_price"`
	SubscriptionDiscountPercent int     `json:"subscription_discount_percent"`
	SubscriptionDurationDays    int     `json:"subscription_duration_days"`
}

// UpdateResellerCommercialSettings commits the complete reseller price and
// access tuple together so readers never depend on a partially saved form.
func UpdateResellerCommercialSettings(c *gin.Context) {
	request := resellerCommercialSettingsRequest{}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "invalid reseller settings request",
		})
		return
	}

	settings := operation_setting.ResellerSetting{
		BaseCostPerMillion:          request.BaseCostPerMillion,
		Endpoint:                    request.Endpoint,
		SubscriptionPrice:           request.SubscriptionPrice,
		SubscriptionDiscountPercent: request.SubscriptionDiscountPercent,
		SubscriptionDurationDays:    request.SubscriptionDurationDays,
	}
	if err := model.UpdateResellerCommercialSettings(settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	common.ApiSuccess(c, settings)
}
