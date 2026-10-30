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
import { getReferencePriceUSD } from '@/features/pricing/lib/reference-price'
import type { PricingModel } from '@/features/pricing/types'

import type { UserUsageSummaryItem } from '../../types'

export interface UsageInsightsMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheTokens: number
  officialCost: number
  actualCoveredCost: number
  savings: number
}

function nonNegativeNumber(value: number): number {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return 0
  return Math.max(0, normalized)
}

export function calculateUsageInsights(
  rows: UserUsageSummaryItem[],
  pricing: PricingModel[],
  quotaPerUnit: number
): UsageInsightsMetrics {
  const pricingByModel = new Map(
    pricing.map((model) => [model.model_name, model])
  )
  const safeQuotaPerUnit = Math.max(1, nonNegativeNumber(quotaPerUnit))

  let promptTokens = 0
  let completionTokens = 0
  let cacheTokens = 0
  let officialCost = 0
  let actualCoveredCost = 0

  for (const row of rows) {
    const rowPromptTokens = nonNegativeNumber(row.prompt_tokens)
    const rowCompletionTokens = nonNegativeNumber(row.completion_tokens)
    promptTokens += rowPromptTokens
    completionTokens += rowCompletionTokens
    const rowCacheTokens = nonNegativeNumber(row.cache_tokens)
    cacheTokens += rowCacheTokens

    const model = pricingByModel.get(row.model_name)
    if (!model) continue

    let referenceCost: number | null = null
    if (model.quota_type === 1) {
      const requestPrice = getReferencePriceUSD(model, 'request')
      if (requestPrice != null) {
        referenceCost = requestPrice * nonNegativeNumber(row.request_count)
      }
    } else {
      const inputPrice = getReferencePriceUSD(model, 'input')
      const outputPrice = getReferencePriceUSD(model, 'output')
      if (inputPrice != null && outputPrice != null) {
        referenceCost =
          (rowPromptTokens / 1_000_000) * inputPrice +
          (rowCompletionTokens / 1_000_000) * outputPrice
      }
    }

    if (referenceCost == null) continue
    officialCost += referenceCost
    actualCoveredCost += nonNegativeNumber(row.quota) / safeQuotaPerUnit
  }

  const totalTokens = promptTokens + completionTokens
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheTokens,
    officialCost,
    actualCoveredCost,
    savings: Math.max(0, officialCost - actualCoveredCost),
  }
}
