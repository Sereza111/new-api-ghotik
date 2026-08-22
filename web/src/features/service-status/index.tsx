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
import { Activity } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout/components/public-layout'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { formatUptimePct } from '@/features/performance-metrics/lib/format'
import type { PerfModelSummary } from '@/features/performance-metrics/types'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useStatus } from '@/hooks/use-status'

import { getUptimeStatus } from './api'
import { ModelStatusTable } from './components/model-status-table'
import { StatusSummary } from './components/status-summary'

const PERFORMANCE_WINDOW_HOURS = 24

function averageMetric(
  models: PerfModelSummary[],
  readValue: (model: PerfModelSummary) => number
): number {
  const values = models.map(readValue).filter(Number.isFinite)
  if (values.length === 0) return Number.NaN
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function ServiceStatus() {
  const { t } = useTranslation()
  const statusQuery = useStatus()
  const pricingQuery = usePricingData()
  const metricsQuery = useQuery({
    queryKey: ['perf-metrics-summary', PERFORMANCE_WINDOW_HOURS],
    queryFn: () => getPerfMetricsSummary(PERFORMANCE_WINDOW_HOURS),
    staleTime: 60 * 1000,
    retry: false,
  })
  const uptimeQuery = useQuery({
    queryKey: ['uptime-status'],
    queryFn: getUptimeStatus,
    staleTime: 60 * 1000,
    retry: false,
  })

  const metrics = useMemo(
    () => metricsQuery.data?.data.models ?? [],
    [metricsQuery.data]
  )
  const metricsByModel = useMemo(
    () => new Map(metrics.map((metric) => [metric.model_name, metric])),
    [metrics]
  )
  const monitors = useMemo(
    () => uptimeQuery.data?.data.flatMap((group) => group.monitors) ?? [],
    [uptimeQuery.data]
  )

  const gatewayReady = !statusQuery.loading && !statusQuery.error
  const catalogReady =
    !pricingQuery.isLoading &&
    !pricingQuery.error &&
    pricingQuery.models.length > 0
  const metricsReady = !metricsQuery.isLoading && !metricsQuery.error
  const allOperational = gatewayReady && catalogReady && metricsReady
  const averageSuccess = averageMetric(metrics, (model) => model.success_rate)
  const averageLatency = averageMetric(metrics, (model) => model.avg_latency_ms)
  const averageTps = averageMetric(metrics, (model) => model.avg_tps)

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-24 pb-14 sm:px-6 lg:px-8'>
        <header className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <Activity className='text-primary size-7' aria-hidden='true' />
            <h1 className='font-serif text-3xl font-semibold sm:text-4xl'>
              {t('Service Status')}
            </h1>
            <Badge variant={allOperational ? 'secondary' : 'warning'}>
              {allOperational
                ? t('All systems operational')
                : t('Some systems are degraded')}
            </Badge>
            <Badge variant='outline'>{t('Last 24 hours')}</Badge>
          </div>
          <p className='text-muted-foreground max-w-3xl text-sm leading-6'>
            {t(
              'Live metrics from the last 24 hours. Models without recent traffic are shown as configured, not falsely operational.'
            )}
          </p>
        </header>

        <StatusSummary
          gatewayReady={gatewayReady}
          gatewayLoading={statusQuery.loading}
          metricsLoading={metricsQuery.isLoading}
          catalogLoading={pricingQuery.isLoading}
          metricModelCount={metrics.length}
          catalogModelCount={pricingQuery.models.length}
          averageSuccess={averageSuccess}
          averageLatency={averageLatency}
          averageTps={averageTps}
        />

        <ModelStatusTable
          models={pricingQuery.models}
          metricsByModel={metricsByModel}
          loading={pricingQuery.isLoading}
        />

        {monitors.length > 0 ? (
          <section className='overflow-hidden rounded-md border'>
            <div className='bg-muted/20 border-b px-4 py-3'>
              <h2 className='text-sm font-semibold'>{t('Uptime')}</h2>
            </div>
            {monitors.map((monitor) => (
              <div
                key={`${monitor.group ?? 'default'}:${monitor.name}`}
                className='flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0'
              >
                <div className='min-w-0'>
                  <div className='truncate text-sm font-medium'>
                    {monitor.name}
                  </div>
                  {monitor.group && (
                    <div className='text-muted-foreground text-xs'>
                      {monitor.group}
                    </div>
                  )}
                </div>
                <span className='font-mono text-sm tabular-nums'>
                  {formatUptimePct(monitor.uptime * 100)}
                </span>
              </div>
            ))}
          </section>
        ) : (
          !uptimeQuery.isLoading && (
            <p className='text-muted-foreground text-xs'>
              {t('Historical uptime monitoring is not configured yet.')}
            </p>
          )
        )}
      </PageTransition>
    </PublicLayout>
  )
}
