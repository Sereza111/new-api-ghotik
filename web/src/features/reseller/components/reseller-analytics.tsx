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
import { VChart } from '@visactor/react-vchart'
import { CircleDollarSign, KeyRound, TrendingUp, Zap } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import type { ResellerKey } from '../types'

type ResellerAnalyticsProps = {
  keys: ResellerKey[]
  formatMoney: (value: number) => string
}

type DailyValue = {
  date: string
  metric: string
  value: number
}

function safeMoney(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function ResellerAnalytics(props: ResellerAnalyticsProps) {
  const { formatMoney, keys } = props
  const { i18n, t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const salesLabel = t('Issued key value')
  const profitLabel = t('Estimated profit')
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
      }),
    [locale]
  )

  const analytics = useMemo(() => {
    let activeKeys = 0
    let issuedMillions = 0
    let salesValue = 0
    let estimatedProfit = 0
    const daily = new Map<
      string,
      { salesValue: number; estimatedProfit: number }
    >()

    for (const key of keys) {
      if (key.status === 1) activeKeys++
      issuedMillions += Math.max(0, key.token_millions)
      const keySalesValue = safeMoney(key.client_price)
      const keyProfit = keySalesValue - safeMoney(key.cost)
      salesValue += keySalesValue
      estimatedProfit += keyProfit

      if (!Number.isFinite(key.created_time) || key.created_time <= 0) continue
      const created = new Date(key.created_time * 1000)
      const date = [
        created.getFullYear(),
        String(created.getMonth() + 1).padStart(2, '0'),
        String(created.getDate()).padStart(2, '0'),
      ].join('-')
      const bucket = daily.get(date) ?? { salesValue: 0, estimatedProfit: 0 }
      bucket.salesValue += keySalesValue
      bucket.estimatedProfit += keyProfit
      daily.set(date, bucket)
    }

    const values: DailyValue[] = []
    for (const [date, bucket] of [...daily.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      values.push({ date, metric: salesLabel, value: bucket.salesValue })
      values.push({
        date,
        metric: profitLabel,
        value: bucket.estimatedProfit,
      })
    }

    return {
      activeKeys,
      issuedMillions,
      salesValue,
      estimatedProfit,
      values,
    }
  }, [keys, profitLabel, salesLabel])

  const dark = resolvedTheme === 'dark'
  const textColor = dark
    ? 'rgba(255, 255, 255, 0.68)'
    : 'rgba(15, 23, 42, 0.68)'
  const gridColor = dark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(15, 23, 42, 0.12)'
  const salesColor = dark ? '#7bc8e2' : '#287f9f'
  const profitColor = dark ? '#60c8a5' : '#24856a'
  const chartSpec = useMemo(
    () => ({
      type: 'bar' as const,
      data: [{ id: 'reseller-revenue', values: analytics.values }],
      xField: 'date',
      yField: 'value',
      seriesField: 'metric',
      legends: { visible: false },
      paddingInner: 0.42,
      color: {
        specified: {
          [salesLabel]: salesColor,
          [profitLabel]: profitColor,
        },
      },
      bar: { style: { cornerRadius: [3, 3, 0, 0] } },
      axes: [
        {
          orient: 'bottom' as const,
          label: {
            formatMethod: (value: string) =>
              dateFormatter.format(new Date(`${value}T00:00:00`)),
            style: { fill: textColor, fontSize: 10 },
            autoRotate: true,
          },
          tick: { visible: false },
          domainLine: { visible: false },
        },
        {
          orient: 'left' as const,
          label: {
            formatMethod: (value: number | string) =>
              formatMoney(Number(value)),
            style: { fill: textColor, fontSize: 10 },
          },
          tick: { visible: false },
          domainLine: { visible: false },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: gridColor },
          },
        },
      ],
      tooltip: {
        mark: {
          title: {
            value: (datum: DailyValue) =>
              dateFormatter.format(new Date(`${datum.date}T00:00:00`)),
          },
          content: [
            {
              key: (datum: DailyValue) => datum.metric,
              value: (datum: DailyValue) => formatMoney(datum.value),
            },
          ],
        },
      },
      animationAppear: { duration: 450 },
    }),
    [
      analytics.values,
      dateFormatter,
      gridColor,
      profitColor,
      profitLabel,
      formatMoney,
      salesColor,
      salesLabel,
      textColor,
    ]
  )

  let chart: ReactNode
  if (analytics.values.length === 0) {
    chart = (
      <div className='text-muted-foreground flex h-52 items-center justify-center text-sm'>
        {t('Revenue history will appear after the first key is issued.')}
      </div>
    )
  } else if (!themeReady) {
    chart = <Skeleton className='h-52 w-full' />
  } else {
    chart = (
      <div
        role='img'
        aria-label={`${salesLabel}: ${formatMoney(analytics.salesValue)}; ${profitLabel}: ${formatMoney(analytics.estimatedProfit)}`}
        className='h-52 w-full'
      >
        <VChart
          key={`reseller-revenue-${resolvedTheme}`}
          spec={{
            ...chartSpec,
            theme: dark ? 'dark' : 'light',
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      </div>
    )
  }

  return (
    <section aria-labelledby='reseller-analytics-title' className='border-y'>
      <div className='grid sm:grid-cols-2 xl:grid-cols-4'>
        <AnalyticsMetric
          icon={<KeyRound aria-hidden='true' />}
          label={t('Issued keys')}
          value={formatCompactNumber(keys.length, locale)}
        />
        <AnalyticsMetric
          icon={<Zap aria-hidden='true' />}
          label={t('Active keys')}
          value={formatCompactNumber(analytics.activeKeys, locale)}
        />
        <AnalyticsMetric
          icon={<CircleDollarSign aria-hidden='true' />}
          label={salesLabel}
          value={formatMoney(analytics.salesValue)}
        />
        <AnalyticsMetric
          icon={<TrendingUp aria-hidden='true' />}
          label={profitLabel}
          value={formatMoney(analytics.estimatedProfit)}
        />
      </div>

      <div className='border-t p-4 sm:p-5'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h3 id='reseller-analytics-title' className='text-sm font-semibold'>
              {t('Reseller revenue')}
            </h3>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Based on client prices saved when each key was issued.')}
            </p>
          </div>
          <p className='text-muted-foreground text-xs tabular-nums'>
            {t('Issued quota')}:{' '}
            {formatCompactNumber(analytics.issuedMillions, locale)}M
          </p>
        </div>
        {chart}
        <ul className='flex flex-wrap gap-x-6 gap-y-2 text-xs'>
          <li className='flex items-center gap-2'>
            <span
              className='size-2 rounded-sm'
              style={{ backgroundColor: salesColor }}
              aria-hidden='true'
            />
            <span className='text-muted-foreground'>{salesLabel}</span>
          </li>
          <li className='flex items-center gap-2'>
            <span
              className='size-2 rounded-sm'
              style={{ backgroundColor: profitColor }}
              aria-hidden='true'
            />
            <span className='text-muted-foreground'>{profitLabel}</span>
          </li>
        </ul>
      </div>
    </section>
  )
}

type AnalyticsMetricProps = {
  icon: ReactNode
  label: string
  value: string
}

function AnalyticsMetric(props: AnalyticsMetricProps) {
  return (
    <div className='flex min-w-0 items-center gap-3 border-b p-4 sm:odd:border-r xl:border-r xl:border-b-0 xl:last:border-r-0'>
      <span className='bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-4'>
        {props.icon}
      </span>
      <div className='min-w-0'>
        <p className='text-muted-foreground truncate text-xs'>{props.label}</p>
        <p className='mt-1 truncate font-mono text-lg font-semibold tabular-nums'>
          {props.value}
        </p>
      </div>
    </div>
  )
}
