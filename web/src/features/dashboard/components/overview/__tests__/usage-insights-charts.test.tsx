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
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { UsageInsightsCharts } from '../usage-insights-charts'
import type { UsageInsightsMetrics } from '../usage-insights-data'

const chartMock = vi.hoisted(() => vi.fn())

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: unknown) => {
    chartMock(props)
    return <div data-testid='vchart' />
  },
}))

vi.mock('@/lib/use-chart-theme', () => ({
  useChartTheme: () => ({ resolvedTheme: 'dark', themeReady: true }),
}))

const metrics: UsageInsightsMetrics = {
  promptTokens: 2_000_000,
  completionTokens: 1_000_000,
  totalTokens: 3_000_000,
  cacheTokens: 900_000,
  officialCost: 40,
  actualCoveredCost: 4,
  savings: 36,
}

describe('UsageInsightsCharts', () => {
  beforeEach(() => {
    chartMock.mockClear()
  })

  test('renders accessible token and cost visualizations with visible legends', () => {
    render(<UsageInsightsCharts metrics={metrics} />)

    expect(
      screen.getByRole('img', {
        name: /Input tokens: .*; Output tokens:/,
      })
    ).toBeVisible()
    expect(
      screen.getByRole('img', {
        name: /Our price: .*; Official price:/,
      })
    ).toBeVisible()
    expect(screen.getAllByTestId('vchart')).toHaveLength(2)
    expect(screen.getAllByText('Tokens read from cache')).toHaveLength(1)
    expect(screen.getAllByText('Estimated savings')).toHaveLength(1)
    expect(
      document.querySelector('[data-slot="usage-token-chart-section"]')
    ).toHaveClass('min-h-80')
    expect(
      document.querySelector('[data-slot="usage-cost-chart-section"]')
    ).toHaveClass('min-h-80')
    expect(
      chartMock.mock.calls[0]?.[0].spec.data[0].values.map(
        (item: { kind: string }) => item.kind
      )
    ).toEqual(['Input tokens', 'Output tokens'])
    expect(
      chartMock.mock.calls[1]?.[0].spec.data[0].values.map(
        (item: { kind: string }) => item.kind
      )
    ).toEqual(['Our price', 'Official price'])
  })

  test('shows stable empty states instead of blank charts without usage', () => {
    const emptyMetrics: UsageInsightsMetrics = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheTokens: 0,
      officialCost: 0,
      actualCoveredCost: 0,
      savings: 0,
    }

    render(<UsageInsightsCharts metrics={emptyMetrics} />)

    expect(screen.getAllByText('No data')).toHaveLength(2)
    expect(screen.queryByTestId('vchart')).not.toBeInTheDocument()
  })
})
