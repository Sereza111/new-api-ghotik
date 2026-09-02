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
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { RoutingSourcesData } from '../types'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('../api', () => ({
  getRoutingSources: apiMock.get,
  updateRoutingSource: apiMock.update,
  resetRoutingSource: apiMock.reset,
  routingSourcesQueryKey: ['routing', 'sources'],
}))

vi.mock('@/components/page-transition', () => ({
  PageTransition: (props: { children: ReactNode; className?: string }) => (
    <div className={props.className}>{props.children}</div>
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: ReactNode; to: string }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { auth: { user: null } }) => unknown
  ): unknown => selector({ auth: { user: null } }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const { Routing } = await import('../index')

const routingData: RoutingSourcesData = {
  families: [
    {
      id: 'gpt',
      label: 'GPT',
      selected_source_id: 'standard',
      default_source_id: '',
      fallback_description: 'Fallback to the API key route',
      sources: [
        {
          id: 'standard',
          label: 'GPT Team/Plus',
          description: 'Standard GPT source',
          price_multiplier: 1,
          model_count: 8,
          is_default: true,
        },
      ],
    },
  ],
  sources: [
    {
      id: 'standard',
      label: 'GPT Team/Plus',
      description: 'Standard GPT source',
      price_multiplier: 1,
      model_count: 8,
      is_default: true,
    },
  ],
}

const queryClients: QueryClient[] = []

function renderRouting(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <Routing />
    </QueryClientProvider>
  )
  return queryClient
}

afterEach(() => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
})

describe('routing source page states', () => {
  test('shows family selectors and the source catalog after loading', async () => {
    apiMock.get.mockResolvedValue({ success: true, data: routingData })

    renderRouting()

    expect(
      await screen.findByRole('heading', { name: 'Model sources' })
    ).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Source for GPT' })
    ).toHaveTextContent('GPT Team/Plus')
    expect(
      screen.getByRole('heading', { name: 'Available sources' })
    ).toBeVisible()
    expect(screen.getAllByText('Standard GPT source')).toHaveLength(2)
    expect(
      screen.getByRole('columnheader', { name: 'Price multiplier' })
    ).toBeVisible()
  })

  test('keeps a stable loading region while the catalog request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    apiMock.get.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    renderRouting()

    expect(screen.getByLabelText('Loading routing sources')).toBeVisible()

    await act(async () => {
      resolveRequest?.({ success: true, data: routingData })
    })
    expect(await screen.findByRole('heading', { name: 'GPT' })).toBeVisible()
  })

  test('offers a retry after a failed catalog request', async () => {
    apiMock.get
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ success: true, data: routingData })

    renderRouting()

    expect(
      await screen.findByText('Unable to load routing sources')
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'GPT' })).toBeVisible()
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  test('shows the account-level empty state when no family is selectable', async () => {
    apiMock.get.mockResolvedValue({
      success: true,
      data: { families: [], sources: [] },
    })

    renderRouting()

    expect(
      await screen.findByText('No routing sources are available')
    ).toBeVisible()
    expect(
      screen.getByText('This account has no selectable model sources.')
    ).toBeVisible()
  })
})
