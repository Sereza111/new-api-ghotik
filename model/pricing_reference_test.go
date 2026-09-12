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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPricingReferencePriceReturnsCatalogPrices(t *testing.T) {
	referencePrice := getPricingReferencePrice("gpt-5.6-sol")

	require.NotNil(t, referencePrice)
	assert.Equal(t, 4.0, referencePrice.InputUSD)
	assert.Equal(t, 20.0, referencePrice.OutputUSD)
	assert.Zero(t, referencePrice.RequestUSD)
}

func TestGetPricingReferencePriceReturnsAstraStandardPrices(t *testing.T) {
	referencePrice := getPricingReferencePrice("gpt-6-astra")

	require.NotNil(t, referencePrice)
	assert.Equal(t, 10.0, referencePrice.InputUSD)
	assert.Equal(t, 50.0, referencePrice.OutputUSD)
	assert.Zero(t, referencePrice.RequestUSD)
}

func TestGetPricingReferencePriceReturnsImageModelPrices(t *testing.T) {
	for _, modelName := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		referencePrice := getPricingReferencePrice(modelName)
		require.NotNil(t, referencePrice)
		if modelName == "gpt-image-2.5-flare" {
			assert.Equal(t, 0.5, referencePrice.RequestUSD)
		} else {
			assert.Equal(t, 1.0, referencePrice.RequestUSD)
		}
		assert.Zero(t, referencePrice.InputUSD)
		assert.Zero(t, referencePrice.OutputUSD)
	}
}

func TestGetPricingReferencePriceReturnsIndependentCopy(t *testing.T) {
	first := getPricingReferencePrice("gpt-5.6-sol")
	require.NotNil(t, first)
	first.InputUSD = 999

	second := getPricingReferencePrice("gpt-5.6-sol")
	require.NotNil(t, second)
	assert.Equal(t, 4.0, second.InputUSD)
}

func TestGetPricingReferencePriceOmitsUnknownModels(t *testing.T) {
	assert.Nil(t, getPricingReferencePrice("custom-model"))
}
