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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { UsageInsights } from '../usage-insights'

const apiMock = vi.hoisted(() => ({
  usage: vi.fn(),
  pricing: vi.fn(),
}))

vi.mock('@/features/dashboard/api', () => ({
  getUserUsageSummary: apiMock.usage,
}))

vi.mock('@/features/pricing/api', () => ({
  getPricing: apiMock.pricing,
}))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({ currency: { quotaPerUnit: 500_000 } }),
}))

vi.mock('@/components/page-transition', () => ({
  FadeIn: (props: { children: ReactNode }) => <div>{props.children}</div>,
}))

vi.mock('../usage-insights-charts', () => ({
  UsageInsightsCharts: () => <div data-testid='usage-insights-charts' />,
}))

const usageResponse = { success: true, data: [] }
const pricingResponse = {
  success: true,
  data: [],
  vendors: [],
  group_ratio: {},
  usable_group: {},
  supported_endpoint: {},
  auto_groups: [],
}
const queryClients: QueryClient[] = []

function renderUsageInsights() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <UsageInsights />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  apiMock.usage.mockReset().mockResolvedValue(usageResponse)
  apiMock.pricing.mockReset().mockResolvedValue(pricingResponse)
})

afterEach(() => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
})

describe('UsageInsights', () => {
  test.each([
    ['usage', apiMock.usage, apiMock.pricing, usageResponse],
    ['pricing', apiMock.pricing, apiMock.usage, pricingResponse],
  ])(
    'shows an honest retry state when the %s request fails',
    async (_name, failingRequest, successfulRequest, retryResponse) => {
      failingRequest
        .mockReset()
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce(retryResponse)

      renderUsageInsights()

      expect(await screen.findByText('Failed to load')).toBeVisible()
      expect(
        screen.queryByTestId('usage-insights-charts')
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(failingRequest).toHaveBeenCalledTimes(2))
      expect(successfulRequest).toHaveBeenCalledTimes(1)
      expect(await screen.findByTestId('usage-insights-charts')).toBeVisible()
      expect(screen.queryByText('Failed to load')).not.toBeInTheDocument()
    }
  )

  test('treats an HTTP 200 failure payload as an error', async () => {
    apiMock.usage.mockResolvedValue({ success: false, data: [] })

    renderUsageInsights()

    expect(await screen.findByText('Failed to load')).toBeVisible()
    expect(
      screen.queryByTestId('usage-insights-charts')
    ).not.toBeInTheDocument()
  })
})
