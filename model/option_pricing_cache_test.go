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
package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdatingModelRatioInvalidatesPricingCache(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	optionMapWasNil := common.OptionMap == nil
	if optionMapWasNil {
		common.OptionMap = make(map[string]string)
	}
	previousValue, hadPreviousValue := common.OptionMap["ModelRatio"]
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if optionMapWasNil {
			common.OptionMap = nil
		} else if hadPreviousValue {
			common.OptionMap["ModelRatio"] = previousValue
		} else {
			delete(common.OptionMap, "ModelRatio")
		}
	})

	updatePricingLock.Lock()
	pricingMap = []Pricing{{ModelName: "stale-model"}}
	lastGetPricingTime = time.Now()
	updatePricingLock.Unlock()

	require.NoError(t, updateOptionMap("ModelRatio", ratio_setting.ModelRatio2JSONString()))

	updatePricingLock.Lock()
	defer updatePricingLock.Unlock()
	assert.Empty(t, pricingMap)
	assert.True(t, lastGetPricingTime.IsZero())
}
