/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package relay

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// validateResellerOutboundHardCap maps the final-body validation failure to a
// client-visible error before the request is handed to an upstream provider.
func validateResellerOutboundHardCap(c *gin.Context, info *relaycommon.RelayInfo, jsonData []byte) *types.NewAPIError {
	if err := service.ValidateResellerOutboundHardCapWithContext(c, info, jsonData); err != nil {
		status := http.StatusBadRequest
		code := types.ErrorCodeInvalidRequest
		if errors.Is(err, model.ErrResellerTokenQuotaInsufficient) {
			status = http.StatusForbidden
			code = types.ErrorCodePreConsumeTokenQuotaFailed
		}
		return types.NewErrorWithStatusCode(
			fmt.Errorf("reseller request hard-cap validation failed: %w", err),
			code,
			status,
			types.ErrOptionWithSkipRetry(),
		)
	}
	return nil
}

func validateResellerPassThroughHardCap(c *gin.Context, info *relaycommon.RelayInfo, storage common.BodyStorage) *types.NewAPIError {
	jsonData, err := storage.Bytes()
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if err := service.ValidateResellerOutboundHardCapForFormat(c, info, info.RelayFormat, jsonData); err != nil {
		status := http.StatusBadRequest
		code := types.ErrorCodeInvalidRequest
		if errors.Is(err, model.ErrResellerTokenQuotaInsufficient) {
			status = http.StatusForbidden
			code = types.ErrorCodePreConsumeTokenQuotaFailed
		}
		return types.NewErrorWithStatusCode(
			fmt.Errorf("reseller request hard-cap validation failed: %w", err),
			code,
			status,
			types.ErrOptionWithSkipRetry(),
		)
	}
	return nil
}
