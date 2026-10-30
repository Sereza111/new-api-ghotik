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
import { formatCurrencyFromUSD } from '@/lib/currency'

import { TOKEN_UNIT_DIVISORS } from '../constants'
import type { PricingModel, TokenUnit, PriceType } from '../types'
import {
  calculateRequestPriceInUSD,
  calculateTokenPriceInUSD,
  stripTrailingZeros,
} from './price'

type ReferencePriceType = Extract<PriceType, 'input' | 'output'> | 'request'

export type CurrentPriceOptions = {
  showRechargePrice?: boolean
  priceRate?: number
  usdExchangeRate?: number
  selectedGroup?: string
}

export function getReferencePriceUSD(
  model: PricingModel,
  type: ReferencePriceType
): number | null {
  const referencePrice = model.reference_price
  if (!referencePrice) return null

  let price: number | undefined
  if (type === 'input') price = referencePrice.input_usd
  if (type === 'output') price = referencePrice.output_usd
  if (type === 'request') price = referencePrice.request_usd

  if (price == null || !Number.isFinite(price) || price <= 0) return null
  return price
}

export function formatReferencePrice(
  model: PricingModel,
  type: ReferencePriceType,
  tokenUnit: TokenUnit = 'M'
): string | null {
  const price = getReferencePriceUSD(model, type)
  if (price == null) return null

  const normalizedPrice =
    type === 'request' ? price : price / TOKEN_UNIT_DIVISORS[tokenUnit]
  return stripTrailingZeros(
    formatCurrencyFromUSD(normalizedPrice, {
      digitsLarge: 4,
      digitsSmall: 4,
      abbreviate: false,
    })
  )
}

export function calculateDiscountPercent(
  referencePrice: number | null,
  currentPrice: number
): number | null {
  if (
    referencePrice == null ||
    !Number.isFinite(currentPrice) ||
    currentPrice < 0 ||
    currentPrice >= referencePrice
  ) {
    return null
  }

  return Math.round((1 - currentPrice / referencePrice) * 100)
}

export function getTokenDiscountPercent(
  model: PricingModel,
  type: Extract<PriceType, 'input' | 'output'>,
  options: CurrentPriceOptions = {}
): number | null {
  const currentPrice = calculateTokenPriceInUSD(
    model,
    type,
    options.showRechargePrice,
    options.priceRate,
    options.usdExchangeRate,
    options.selectedGroup
  )
  return calculateDiscountPercent(
    getReferencePriceUSD(model, type),
    currentPrice
  )
}

export function getRequestDiscountPercent(
  model: PricingModel,
  options: CurrentPriceOptions = {}
): number | null {
  const currentPrice = calculateRequestPriceInUSD(
    model,
    options.showRechargePrice,
    options.priceRate,
    options.usdExchangeRate,
    options.selectedGroup
  )
  return calculateDiscountPercent(
    getReferencePriceUSD(model, 'request'),
    currentPrice
  )
}
