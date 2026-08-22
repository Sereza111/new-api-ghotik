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
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateDotClass,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import type { PerfModelSummary } from '@/features/performance-metrics/types'
import type { PricingModel } from '@/features/pricing/types'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

type ModelStatusTableProps = {
  models: PricingModel[]
  metricsByModel: Map<string, PerfModelSummary>
  loading: boolean
}

export function ModelStatusTable(props: ModelStatusTableProps) {
  const { t } = useTranslation()
  return (
    <section className='overflow-hidden rounded-md border'>
      <div className='overflow-x-auto'>
        <div className='min-w-[820px]'>
          <div className='bg-muted/20 grid grid-cols-[minmax(240px,1fr)_110px_130px_130px_180px] gap-4 border-b px-4 py-3 text-xs font-medium'>
            <span>{t('Model')}</span>
            <span>{t('Success rate')}</span>
            <span>{t('Average latency')}</span>
            <span>{t('Throughput')}</span>
            <span>{t('Recent intervals')}</span>
          </div>
          {props.loading ? (
            <StatusRowsSkeleton />
          ) : (
            props.models.map((model) => (
              <ModelStatusRow
                key={model.model_name}
                model={model}
                metric={props.metricsByModel.get(model.model_name)}
              />
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function ModelStatusRow(props: {
  model: PricingModel
  metric: PerfModelSummary | undefined
}) {
  const { t } = useTranslation()
  const modelIconKey = props.model.icon || props.model.vendor_icon
  const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 16) : null
  const rates =
    props.metric?.recent_success_rates?.filter(Number.isFinite) ?? []

  return (
    <div className='grid grid-cols-[minmax(240px,1fr)_110px_130px_130px_180px] items-center gap-4 border-b px-4 py-3 last:border-b-0'>
      <div className='flex min-w-0 items-center gap-3'>
        <span
          className={cn(
            'size-2 shrink-0 rounded-full',
            props.metric
              ? getSuccessRateDotClass(props.metric.success_rate)
              : 'bg-muted-foreground/35'
          )}
          aria-hidden='true'
        />
        <span className='flex size-5 shrink-0 items-center justify-center'>
          {modelIcon}
        </span>
        <div className='min-w-0'>
          <div className='truncate font-mono text-sm font-medium'>
            {props.model.model_name}
          </div>
          <div className='text-muted-foreground truncate text-xs'>
            {props.model.vendor_name ?? t('Configured')}
          </div>
        </div>
      </div>
      {props.metric ? (
        <>
          <span
            className={cn(
              'font-mono text-sm font-semibold tabular-nums',
              getSuccessRateTextClass(props.metric.success_rate)
            )}
          >
            {formatUptimePct(props.metric.success_rate)}
          </span>
          <span className='font-mono text-sm tabular-nums'>
            {formatLatency(props.metric.avg_latency_ms)}
          </span>
          <span className='font-mono text-sm tabular-nums'>
            {formatThroughput(props.metric.avg_tps)}
          </span>
          <RecentIntervals rates={rates} />
        </>
      ) : (
        <div className='text-muted-foreground col-span-4 text-sm'>
          {t('No recent traffic')}
        </div>
      )}
    </div>
  )
}

function RecentIntervals(props: { rates: number[] }) {
  const { t } = useTranslation()
  const rates = props.rates.slice(-6)
  if (rates.length === 0) {
    return <span className='text-muted-foreground text-xs'>—</span>
  }
  const occurrences = new Map<number, number>()
  const rateItems = rates.map((rate) => {
    const occurrence = (occurrences.get(rate) ?? 0) + 1
    occurrences.set(rate, occurrence)
    return { key: `${rate}:${occurrence}`, rate }
  })

  return (
    <div
      className='flex items-center gap-1'
      aria-label={t('Recent success rates')}
    >
      {rateItems.map((item) => (
        <span
          key={item.key}
          title={formatUptimePct(item.rate)}
          className={cn(
            'h-5 min-w-5 flex-1 rounded-sm',
            getSuccessRateDotClass(item.rate)
          )}
        />
      ))}
    </div>
  )
}

function StatusRowsSkeleton() {
  return (
    <div className='flex flex-col gap-0'>
      {['first', 'second', 'third'].map((key) => (
        <div key={key} className='grid grid-cols-5 gap-4 border-b px-4 py-3'>
          <Skeleton className='h-8 w-48' />
          <Skeleton className='h-5 w-16' />
          <Skeleton className='h-5 w-20' />
          <Skeleton className='h-5 w-20' />
          <Skeleton className='h-5 w-full' />
        </div>
      ))}
    </div>
  )
}
