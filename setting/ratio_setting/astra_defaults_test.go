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
*/
package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAstraUsesOfficialStandardPricingDefaults(t *testing.T) {
	previousModelRatios := ModelRatio2JSONString()
	previousCompletionRatios := CompletionRatio2JSONString()
	previousCacheRatios := CacheRatio2JSONString()
	previousCreateCacheRatios := CreateCacheRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateModelRatioByJSONString(previousModelRatios))
		require.NoError(t, UpdateCompletionRatioByJSONString(previousCompletionRatios))
		require.NoError(t, UpdateCacheRatioByJSONString(previousCacheRatios))
		require.NoError(t, UpdateCreateCacheRatioByJSONString(previousCreateCacheRatios))
	})

	InitRatioSettings()

	modelRatio, configured, _ := GetModelRatio("gpt-6-astra")
	assert.True(t, configured)
	assert.Equal(t, 5.0, modelRatio)
	assert.Equal(t, 5.0, GetCompletionRatio("gpt-6-astra"))

	cacheRatio, configured := GetCacheRatio("gpt-6-astra")
	assert.True(t, configured)
	assert.Equal(t, 0.1, cacheRatio)

	createCacheRatio, configured := GetCreateCacheRatio("gpt-6-astra")
	assert.True(t, configured)
	assert.Equal(t, 1.25, createCacheRatio)
}
