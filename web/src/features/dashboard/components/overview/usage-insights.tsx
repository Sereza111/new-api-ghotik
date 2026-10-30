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
import { useQuery } from '@tanstack/react-query'
import { Coins, Database, PiggyBank, ReceiptText } from 'lucide-react'
import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserUsageSummary } from '@/features/dashboard/api'
import { getPricing } from '@/features/pricing/api'
import { useSystemConfig } from '@/hooks/use-system-config'
import { computeTimeRange } from '@/lib/time'

import { calculateUsageInsights } from './usage-insights-data'

const LazyUsageInsightsCharts = lazy(() =>
  import('./usage-insights-charts').then((module) => ({
    default: module.UsageInsightsCharts,
  }))
)

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
    queryFn: async () => {
      const response = await getUserUsageSummary(range)
      if (!response.success) throw new Error('Usage summary request failed')
      return response
    },
    staleTime: 60 * 1000,
  })
  const pricingQuery = useQuery({
    queryKey: ['pricing', 'usage-insights'],
    queryFn: async () => {
      const response = await getPricing()
      if (!response.success) throw new Error('Pricing request failed')
      return response
    },
    staleTime: 5 * 60 * 1000,
  })

  const metrics = useMemo(
    () =>
      calculateUsageInsights(
        usageQuery.data?.data ?? [],
        pricingQuery.data?.data ?? [],
        currency.quotaPerUnit
      ),
    [currency.quotaPerUnit, pricingQuery.data?.data, usageQuery.data?.data]
  )

  const loading = usageQuery.isLoading || pricingQuery.isLoading
  const failed = usageQuery.isError || pricingQuery.isError
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
      detail: t('Cached input'),
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

  let charts: ReactNode
  if (loading) {
    charts = (
      <div className='grid border-t lg:grid-cols-2'>
        <div className='min-h-80 border-b p-4 sm:p-5 lg:border-r lg:border-b-0'>
          <Skeleton className='h-4 w-24' />
          <Skeleton className='mt-2 h-3 w-56 max-w-full' />
          <Skeleton className='mt-4 h-48 w-full' />
        </div>
        <div className='min-h-80 p-4 sm:p-5'>
          <Skeleton className='h-4 w-20' />
          <Skeleton className='mt-2 h-3 w-64 max-w-full' />
          <Skeleton className='mt-4 h-48 w-full' />
        </div>
      </div>
    )
  } else {
    charts = (
      <Suspense
        fallback={
          <div className='grid border-t lg:grid-cols-2'>
            <div className='min-h-80 border-b p-5 lg:border-r lg:border-b-0'>
              <Skeleton className='h-56 w-full' />
            </div>
            <div className='min-h-80 p-5'>
              <Skeleton className='h-56 w-full' />
            </div>
          </div>
        }
      >
        <LazyUsageInsightsCharts metrics={metrics} />
      </Suspense>
    )
  }

  let content: ReactNode
  if (failed) {
    content = (
      <ErrorState
        title={t('Failed to load')}
        description={t('Please try again later.')}
        className='min-h-80'
        onRetry={() => {
          if (usageQuery.isError) void usageQuery.refetch()
          if (pricingQuery.isError) void pricingQuery.refetch()
        }}
      />
    )
  } else {
    content = (
      <>
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
        {charts}
      </>
    )
  }

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
      {content}
    </section>
  )
}
