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
import { describe, expect, test } from 'vitest'

import type { UserUsageSummaryItem } from '@/features/dashboard/types'
import type { PricingModel } from '@/features/pricing/types'

import { calculateUsageInsights } from '../usage-insights-data'

function pricingModel(
  overrides: Partial<PricingModel> & Pick<PricingModel, 'model_name'>
): PricingModel {
  return {
    id: 1,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

describe('calculateUsageInsights', () => {
  test('calculates token composition and comparable savings across billing modes', () => {
    const rows: UserUsageSummaryItem[] = [
      {
        model_name: 'gpt-token',
        request_count: 2,
        prompt_tokens: 2_000_000,
        completion_tokens: 1_000_000,
        cache_tokens: 1_000_000,
        quota: 20,
      },
      {
        model_name: 'image-request',
        request_count: 4,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_tokens: 0,
        quota: 10,
      },
    ]
    const pricing: PricingModel[] = [
      pricingModel({
        model_name: 'gpt-token',
        reference_price: { input_usd: 2, output_usd: 6 },
      }),
      pricingModel({
        id: 2,
        model_name: 'image-request',
        quota_type: 1,
        reference_price: { request_usd: 1.5 },
      }),
    ]

    const result = calculateUsageInsights(rows, pricing, 10)

    expect(result).toEqual({
      promptTokens: 2_000_000,
      completionTokens: 1_000_000,
      totalTokens: 3_000_000,
      cacheTokens: 1_000_000,
      officialCost: 16,
      actualCoveredCost: 3,
      savings: 13,
    })
  })

  test('keeps usage totals but excludes models without comparable pricing', () => {
    const rows: UserUsageSummaryItem[] = [
      {
        model_name: 'unpriced',
        request_count: 1,
        prompt_tokens: 120,
        completion_tokens: 30,
        cache_tokens: 20,
        quota: 500,
      },
    ]

    const result = calculateUsageInsights(rows, [], 0)

    expect(result.totalTokens).toBe(150)
    expect(result.cacheTokens).toBe(20)
    expect(result.officialCost).toBe(0)
    expect(result.actualCoveredCost).toBe(0)
    expect(result.savings).toBe(0)
  })
})
