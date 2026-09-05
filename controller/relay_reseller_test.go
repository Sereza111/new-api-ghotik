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
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayRejectsUnmeteredResellerRequestsBeforeUpstream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name   string
		path   string
		format types.RelayFormat
		body   string
	}{
		{name: "image generation", path: "/v1/images/generations", format: types.RelayFormatOpenAIImage, body: `{"model":"gpt-image-1","prompt":"test"}`},
		{name: "image edit", path: "/v1/images/edits", format: types.RelayFormatOpenAIImage, body: `{"model":"gpt-image-1","prompt":"test"}`},
		{name: "audio speech", path: "/v1/audio/speech", format: types.RelayFormatOpenAIAudio, body: `{"model":"tts-1","input":"test"}`},
		{name: "audio transcription", path: "/v1/audio/transcriptions", format: types.RelayFormatOpenAIAudio, body: `{"model":"whisper-1"}`},
		{name: "audio translation", path: "/v1/audio/translations", format: types.RelayFormatOpenAIAudio, body: `{"model":"whisper-1"}`},
		{name: "alpha search", path: "/v1/alpha/search", format: types.RelayFormatOpenAIAlphaSearch, body: `{"model":"gpt-5.6-sol"}`},
		{name: "moderation", path: "/v1/moderations", format: types.RelayFormatOpenAI, body: `{"model":"omni-moderation-latest","input":"test"}`},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodPost, testCase.path, strings.NewReader(testCase.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(ctx, constant.ContextKeyTokenKey, "rsl_opaque-test-key")

			Relay(ctx, testCase.format)

			assert.Equal(t, http.StatusBadRequest, response.Code)
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.Equal(t, string(types.ErrorCodeInvalidRequest), payload.Error.Code)
		})
	}
}
