/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { Coins, Database, PiggyBank, ReceiptText } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { getUserUsageSummary } from '@/features/dashboard/api'
import { getPricing } from '@/features/pricing/api'
import { getReferencePriceUSD } from '@/features/pricing/lib/reference-price'
import { useSystemConfig } from '@/hooks/use-system-config'
import { computeTimeRange } from '@/lib/time'

const numberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 2,
})

const usdFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function UsageInsights() {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const range = useMemo(() => computeTimeRange(30), [])

  const usageQuery = useQuery({
    queryKey: ['dashboard', 'usage-insights', range],
    queryFn: () => getUserUsageSummary(range),
    staleTime: 60 * 1000,
  })
  const pricingQuery = useQuery({
    queryKey: ['pricing', 'usage-insights'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
  })

  const metrics = useMemo(() => {
    const rows = usageQuery.data?.data ?? []
    const pricingByModel = new Map(
      (pricingQuery.data?.data ?? []).map((model) => [model.model_name, model])
    )

    let promptTokens = 0
    let completionTokens = 0
    let cacheTokens = 0
    let officialCost = 0
    let actualCoveredCost = 0

    for (const row of rows) {
      promptTokens += Number(row.prompt_tokens) || 0
      completionTokens += Number(row.completion_tokens) || 0
      cacheTokens += Number(row.cache_tokens) || 0

      const model = pricingByModel.get(row.model_name)
      if (!model) continue

      if (model.quota_type === 1) {
        const requestPrice = getReferencePriceUSD(model, 'request')
        if (requestPrice == null) continue
        officialCost += requestPrice * row.request_count
      } else {
        const inputPrice = getReferencePriceUSD(model, 'input')
        const outputPrice = getReferencePriceUSD(model, 'output')
        if (inputPrice == null || outputPrice == null) continue
        officialCost +=
          (row.prompt_tokens / 1_000_000) * inputPrice +
          (row.completion_tokens / 1_000_000) * outputPrice
      }
      actualCoveredCost += row.quota / Math.max(1, currency.quotaPerUnit)
    }

    const totalTokens = promptTokens + completionTokens
    return {
      totalTokens,
      cacheTokens,
      cacheShare: promptTokens > 0 ? (cacheTokens / promptTokens) * 100 : 0,
      officialCost,
      actualCoveredCost,
      savings: Math.max(0, officialCost - actualCoveredCost),
    }
  }, [currency.quotaPerUnit, pricingQuery.data?.data, usageQuery.data?.data])

  const loading = usageQuery.isLoading || pricingQuery.isLoading
  const items = [
    {
      key: 'tokens',
      icon: Coins,
      title: t('Tokens used'),
      value: numberFormatter.format(metrics.totalTokens),
      detail: t('Input and output tokens over the last 30 days'),
    },
    {
      key: 'cache',
      icon: Database,
      title: t('Tokens read from cache'),
      value: numberFormatter.format(metrics.cacheTokens),
      detail: t('{{value}}% of input tokens', {
        value: metrics.cacheShare.toFixed(1),
      }),
    },
    {
      key: 'official',
      icon: ReceiptText,
      title: t('Official provider price'),
      value: usdFormatter.format(metrics.officialCost),
      detail: t('Estimated from published input and output prices'),
    },
    {
      key: 'savings',
      icon: PiggyBank,
      title: t('Estimated savings'),
      value: usdFormatter.format(metrics.savings),
      detail: t('You paid {{actual}} for comparable traffic', {
        actual: usdFormatter.format(metrics.actualCoveredCost),
      }),
    },
  ]

  return (
    <section className='bg-card overflow-hidden rounded-md border'>
      <header className='border-b px-4 py-3 sm:px-5'>
        <h3 className='text-sm font-semibold sm:text-base'>
          {t('Usage and savings')}
        </h3>
        <p className='text-muted-foreground mt-1 text-xs sm:text-sm'>
          {t('Real token usage compared with official provider pricing')}
        </p>
      </header>
      <div className='grid sm:grid-cols-2 xl:grid-cols-4'>
        {items.map(({ key, icon: Icon, title, value, detail }) => (
          <div
            key={key}
            className='border-b p-4 last:border-b-0 xl:border-r xl:border-b-0 xl:last:border-r-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0'
          >
            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
              <Icon className='text-primary size-4' aria-hidden='true' />
              <span>{title}</span>
            </div>
            {loading ? (
              <Skeleton className='mt-3 h-7 w-24' />
            ) : (
              <div className='mt-3 font-mono text-xl font-semibold tabular-nums'>
                {value}
              </div>
            )}
            <p className='text-muted-foreground mt-1.5 text-xs'>{detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
