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
import { Activity, Gauge, HeartPulse, Server, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

type StatusSummaryProps = {
  gatewayReady: boolean
  gatewayLoading: boolean
  metricsLoading: boolean
  catalogLoading: boolean
  metricModelCount: number
  catalogModelCount: number
  averageSuccess: number
  averageLatency: number
  averageTps: number
}

export function StatusSummary(props: StatusSummaryProps) {
  const { t } = useTranslation()
  return (
    <section className='grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-5'>
      <SummaryMetric
        icon={Server}
        label={t('API gateway')}
        value={props.gatewayReady ? t('Operational') : t('Unavailable')}
        loading={props.gatewayLoading}
      />
      <SummaryMetric
        icon={HeartPulse}
        label={t('Models with metrics')}
        value={t('{{count}} of {{total}} models', {
          count: props.metricModelCount,
          total: props.catalogModelCount,
        })}
        loading={props.catalogLoading || props.metricsLoading}
      />
      <SummaryMetric
        icon={Activity}
        label={t('Success rate')}
        value={formatUptimePct(props.averageSuccess)}
        loading={props.metricsLoading}
        valueClassName={getSuccessRateTextClass(props.averageSuccess)}
      />
      <SummaryMetric
        icon={Timer}
        label={t('Average latency')}
        value={formatLatency(props.averageLatency)}
        loading={props.metricsLoading}
      />
      <SummaryMetric
        icon={Gauge}
        label={t('Throughput')}
        value={formatThroughput(props.averageTps)}
        loading={props.metricsLoading}
      />
    </section>
  )
}

function SummaryMetric(props: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  loading: boolean
  valueClassName?: string
}) {
  const Icon = props.icon
  return (
    <div className='flex min-h-24 flex-col justify-between gap-4 border-b p-4 last:border-b-0 sm:border-r lg:border-b-0'>
      <div className='text-muted-foreground flex items-center gap-2 text-xs'>
        <Icon className='size-4' aria-hidden='true' />
        <span>{props.label}</span>
      </div>
      {props.loading ? (
        <Skeleton className='h-6 w-24' />
      ) : (
        <span
          className={cn(
            'font-mono text-lg font-semibold tabular-nums',
            props.valueClassName
          )}
        >
          {props.value}
        </span>
      )}
    </div>
  )
}
