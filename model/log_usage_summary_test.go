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
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUserUsageSummaryAggregatesConsumeLogsByModel(t *testing.T) {
	truncateTables(t)
	logs := []Log{
		{
			UserId: 1, CreatedAt: 100, Type: LogTypeConsume, ModelName: "gpt-test",
			PromptTokens: 120, CompletionTokens: 30, Quota: 15,
			Other: common.MapToJsonStr(map[string]interface{}{"cache_tokens": 80}),
		},
		{
			UserId: 1, CreatedAt: 110, Type: LogTypeConsume, ModelName: "gpt-test",
			PromptTokens: 50, CompletionTokens: 20, Quota: 8,
			Other: common.MapToJsonStr(map[string]interface{}{"cache_tokens": 10}),
		},
		{
			UserId: 1, CreatedAt: 120, Type: LogTypeConsume, ModelName: "image-test",
			Quota: 25,
		},
		{UserId: 2, CreatedAt: 105, Type: LogTypeConsume, ModelName: "gpt-test", PromptTokens: 999},
		{UserId: 1, CreatedAt: 105, Type: LogTypeTopup, ModelName: "gpt-test", Quota: 999},
		{UserId: 1, CreatedAt: 90, Type: LogTypeConsume, ModelName: "gpt-test", PromptTokens: 999},
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	summary, err := GetUserUsageSummary(1, 100, 120)
	require.NoError(t, err)
	require.Len(t, summary, 2)

	assert.Equal(t, UserUsageSummary{
		ModelName: "gpt-test", RequestCount: 2, PromptTokens: 170,
		CompletionTokens: 50, CacheTokens: 90, Quota: 23,
	}, summary[0])
	assert.Equal(t, UserUsageSummary{
		ModelName: "image-test", RequestCount: 1, Quota: 25,
	}, summary[1])
}
