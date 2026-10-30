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
import { Database, PiggyBank } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import type { UsageInsightsMetrics } from './usage-insights-data'

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

const DARK_CHART_COLORS = {
  input: '#7bc8e2',
  output: '#60c8a5',
  actual: '#7bc8e2',
  official: '#d58e91',
} as const

const LIGHT_CHART_COLORS = {
  input: '#287f9f',
  output: '#24856a',
  actual: '#287f9f',
  official: '#a84f55',
} as const

type UsageInsightsChartsProps = {
  metrics: UsageInsightsMetrics
}

type LegendItemProps = {
  color: string
  label: string
  value: string
}

function LegendItem(props: LegendItemProps) {
  return (
    <li className='flex min-w-0 items-center gap-2'>
      <span
        className='size-2 shrink-0 rounded-sm'
        style={{ backgroundColor: props.color }}
        aria-hidden='true'
      />
      <span className='text-muted-foreground min-w-0 truncate text-xs'>
        {props.label}
      </span>
      <span className='ms-auto shrink-0 font-mono text-xs font-semibold tabular-nums'>
        {props.value}
      </span>
    </li>
  )
}

export function UsageInsightsCharts(props: UsageInsightsChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const dark = resolvedTheme === 'dark'
  const textColor = dark
    ? 'rgba(255, 255, 255, 0.68)'
    : 'rgba(15, 23, 42, 0.68)'
  const gridColor = dark
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(15, 23, 42, 0.12)'
  const colors = dark ? DARK_CHART_COLORS : LIGHT_CHART_COLORS

  const tokenValues = useMemo(
    () => [
      { kind: t('Input tokens'), value: props.metrics.promptTokens },
      { kind: t('Output tokens'), value: props.metrics.completionTokens },
    ],
    [props.metrics.completionTokens, props.metrics.promptTokens, t]
  )
  const costValues = useMemo(
    () => [
      { kind: t('Our price'), value: props.metrics.actualCoveredCost },
      { kind: t('Official price'), value: props.metrics.officialCost },
    ],
    [props.metrics.actualCoveredCost, props.metrics.officialCost, t]
  )

  const tokenSpec = useMemo(
    () => ({
      type: 'pie' as const,
      data: [{ id: 'token-composition', values: tokenValues }],
      outerRadius: 0.84,
      innerRadius: 0.62,
      padAngle: 1.2,
      valueField: 'value',
      categoryField: 'kind',
      legends: { visible: false },
      label: { visible: false },
      color: {
        specified: {
          [t('Input tokens')]: colors.input,
          [t('Output tokens')]: colors.output,
        },
      },
      pie: {
        style: { cornerRadius: 4 },
        state: {
          hover: { outerRadius: 0.88, lineWidth: 0 },
          selected: { outerRadius: 0.88, lineWidth: 0 },
        },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: { kind: string }) => datum.kind,
              value: (datum: { value: number }) =>
                numberFormatter.format(datum.value),
            },
          ],
        },
      },
      animationAppear: { duration: 450 },
    }),
    [colors.input, colors.output, t, tokenValues]
  )

  const costSpec = useMemo(
    () => ({
      type: 'bar' as const,
      direction: 'horizontal' as const,
      data: [{ id: 'cost-comparison', values: costValues }],
      xField: 'value',
      yField: 'kind',
      seriesField: 'kind',
      paddingInner: 0.56,
      legends: { visible: false },
      color: {
        specified: {
          [t('Our price')]: colors.actual,
          [t('Official price')]: colors.official,
        },
      },
      bar: {
        style: { cornerRadius: 4 },
      },
      axes: [
        {
          orient: 'left' as const,
          label: { style: { fill: textColor, fontSize: 11 } },
          tick: { visible: false },
          domainLine: { visible: false },
        },
        {
          orient: 'bottom' as const,
          label: {
            formatMethod: (value: number | string) =>
              usdFormatter.format(Number(value)),
            style: { fill: textColor, fontSize: 10 },
          },
          tick: { visible: false },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: gridColor },
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: { kind: string }) => datum.kind,
              value: (datum: { value: number }) =>
                usdFormatter.format(datum.value),
            },
          ],
        },
      },
      animationAppear: { duration: 450 },
    }),
    [colors.actual, colors.official, costValues, gridColor, t, textColor]
  )

  const chartTheme = dark ? 'dark' : 'light'
  const tokenAriaLabel = `${t('Input tokens')}: ${numberFormatter.format(props.metrics.promptTokens)}; ${t('Output tokens')}: ${numberFormatter.format(props.metrics.completionTokens)}`
  const costAriaLabel = `${t('Our price')}: ${usdFormatter.format(props.metrics.actualCoveredCost)}; ${t('Official price')}: ${usdFormatter.format(props.metrics.officialCost)}`
  let tokenVisualization: ReactNode
  if (props.metrics.totalTokens <= 0) {
    tokenVisualization = (
      <div className='text-muted-foreground flex h-44 items-center justify-center text-xs sm:h-48'>
        {t('No data')}
      </div>
    )
  } else if (!themeReady) {
    tokenVisualization = (
      <Skeleton className='mx-auto my-3 h-40 w-40 rounded-full sm:size-44' />
    )
  } else {
    tokenVisualization = (
      <div
        role='img'
        aria-label={tokenAriaLabel}
        className='mx-auto h-44 w-full max-w-md sm:h-48'
      >
        <VChart
          key={`usage-token-${chartTheme}`}
          spec={{
            ...tokenSpec,
            theme: chartTheme,
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      </div>
    )
  }

  let costVisualization: ReactNode
  if (props.metrics.officialCost <= 0) {
    costVisualization = (
      <div className='text-muted-foreground flex h-44 items-center justify-center text-xs sm:h-48'>
        {t('No data')}
      </div>
    )
  } else if (!themeReady) {
    costVisualization = <Skeleton className='my-4 h-40 w-full sm:h-44' />
  } else {
    costVisualization = (
      <div
        role='img'
        aria-label={costAriaLabel}
        className='mx-auto h-44 w-full max-w-2xl sm:h-48'
      >
        <VChart
          key={`usage-cost-${chartTheme}`}
          spec={{
            ...costSpec,
            theme: chartTheme,
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      </div>
    )
  }

  return (
    <div
      data-slot='usage-insights-charts'
      className='grid border-t lg:grid-cols-2'
    >
      <div
        data-slot='usage-token-chart-section'
        className='min-h-80 border-b p-4 sm:p-5 lg:border-r lg:border-b-0'
      >
        <div>
          <h4 className='text-sm font-semibold'>{t('Tokens used')}</h4>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Input and output tokens over the last 30 days')}
          </p>
        </div>
        {tokenVisualization}
        <ul className='grid gap-2 sm:grid-cols-2'>
          <LegendItem
            color={colors.input}
            label={t('Input tokens')}
            value={numberFormatter.format(props.metrics.promptTokens)}
          />
          <LegendItem
            color={colors.output}
            label={t('Output tokens')}
            value={numberFormatter.format(props.metrics.completionTokens)}
          />
        </ul>
        <div className='border-border/60 mt-3 flex items-center gap-2 border-t pt-3'>
          <Database
            className='text-muted-foreground size-3.5 shrink-0'
            aria-hidden='true'
          />
          <span className='text-muted-foreground min-w-0 truncate text-xs'>
            {t('Tokens read from cache')}
          </span>
          <span className='ms-auto shrink-0 font-mono text-xs font-semibold tabular-nums'>
            {numberFormatter.format(props.metrics.cacheTokens)}
          </span>
        </div>
      </div>

      <div data-slot='usage-cost-chart-section' className='min-h-80 p-4 sm:p-5'>
        <div>
          <h4 className='text-sm font-semibold'>{t('Cost')}</h4>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Estimated from published input and output prices')}
          </p>
        </div>
        {costVisualization}
        <ul className='grid gap-2 sm:grid-cols-2'>
          <LegendItem
            color={colors.actual}
            label={t('Our price')}
            value={usdFormatter.format(props.metrics.actualCoveredCost)}
          />
          <LegendItem
            color={colors.official}
            label={t('Official price')}
            value={usdFormatter.format(props.metrics.officialCost)}
          />
        </ul>
        <div className='border-border/60 mt-3 flex items-center gap-2 border-t pt-3'>
          <PiggyBank
            className='text-success size-3.5 shrink-0'
            aria-hidden='true'
          />
          <span className='text-muted-foreground min-w-0 truncate text-xs'>
            {t('Estimated savings')}
          </span>
          <span className='text-success ms-auto shrink-0 font-mono text-xs font-semibold tabular-nums'>
            {usdFormatter.format(props.metrics.savings)}
          </span>
        </div>
      </div>
    </div>
  )
}
