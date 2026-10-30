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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { fetchUpstreamRatios, getUpstreamChannels } from '../../api'
import { RatioSettingsCard } from '../ratio-settings-card'
import { UpstreamRatioSync } from '../upstream-ratio-sync'

vi.mock('../../api', () => ({
  fetchUpstreamRatios: vi.fn(),
  getUpstreamChannels: vi.fn(),
  updateResellerCommercialSettings: vi.fn(),
  updateSystemOption: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/components/confirm-dialog', () => ({
  ConfirmDialog: (props: { open: boolean; handleConfirm: () => void }) =>
    props.open ? (
      <button type='button' onClick={props.handleConfirm}>
        Confirm reset
      </button>
    ) : null,
}))

vi.mock('../model-ratio-form', () => ({
  ModelRatioForm: (props: { onReset: () => void }) => (
    <button type='button' onClick={props.onReset}>
      Reset model ratios
    </button>
  ),
}))

vi.mock('../upstream-ratio-sync-table', () => ({
  UpstreamRatioSyncTable: (props: {
    prices: Record<string, unknown>
    toolbar?: ReactNode
    onSelectPrices: (
      selections: Array<{ model: string; source: string }>
    ) => void
  }) => (
    <>
      {props.toolbar}
      {Object.keys(props.prices).length ? (
        <button
          type='button'
          onClick={() =>
            props.onSelectPrices([{ model: 'gpt-test', source: 'upstream' }])
          }
        >
          Select upstream price
        </button>
      ) : null}
    </>
  ),
}))

vi.mock('../channel-selector-dialog', () => ({
  ChannelSelectorDialog: (props: {
    open: boolean
    onConfirm: (ids: number[]) => void
  }) =>
    props.open ? (
      <button type='button' onClick={() => props.onConfirm([1])}>
        Confirm price source
      </button>
    ) : null,
}))

vi.mock('../conflict-confirm-dialog', () => ({
  ConflictConfirmDialog: (props: { open: boolean; onConfirm: () => void }) =>
    props.open ? (
      <button type='button' onClick={props.onConfirm}>
        Confirm price sync
      </button>
    ) : null,
}))

const emptyModelRatios = {
  ModelPrice: '{}',
  ModelRatio: '{}',
  CompletionRatio: '{}',
  CacheRatio: '{}',
  CreateCacheRatio: '{}',
  ImageRatio: '{}',
  AudioRatio: '{}',
  AudioCompletionRatio: '{}',
  'billing_setting.billing_mode': '{}',
  'billing_setting.billing_expr': '{}',
}

const pricingBaseline = {
  entries: [
    {
      model_name: 'gpt-test',
      version: 'version-1',
      configured: {},
      effective: { model_ratio: 1 },
    },
  ],
  options: {
    ...emptyModelRatios,
    ModelRatio: '{"gpt-test":1}',
  },
  empty_version: 'empty-version',
}

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  queryClient.setQueryData(['pricing'], { data: [{ model_name: 'stale' }] })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return queryClient
}

describe('model pricing cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().auth.setUser({ role: 100 } as never)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: pricingBaseline },
    })
    vi.spyOn(api, 'patch').mockResolvedValue({
      data: { success: true, message: '' },
    })
    vi.mocked(getUpstreamChannels).mockResolvedValue({
      success: true,
      message: '',
      data: [
        {
          id: 1,
          name: 'upstream',
          base_url: 'https://upstream.example',
          status: 1,
        },
      ],
    })
    vi.mocked(fetchUpstreamRatios).mockResolvedValue({
      success: true,
      message: '',
      data: {
        differences: {},
        prices: {
          'gpt-test': {
            current: { model_ratio: 1 },
            upstreams: { upstream: { model_ratio: 2 } },
          },
        },
        test_results: [{ name: 'upstream', status: 'success' }],
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useAuthStore.setState(useAuthStore.getInitialState(), true)
  })

  test('invalidates pricing after applying an upstream price sync', async () => {
    const user = userEvent.setup()
    const queryClient = renderWithQueryClient(<UpstreamRatioSync />)

    await user.click(
      screen.getByRole('button', { name: 'Select price sources' })
    )
    await user.click(
      await screen.findByRole('button', { name: 'Confirm price source' })
    )
    await user.click(
      await screen.findByRole('button', { name: 'Select upstream price' })
    )
    await user.click(screen.getByRole('button', { name: 'Apply Sync' }))
    await user.click(screen.getByRole('button', { name: 'Confirm price sync' }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['pricing'])?.isInvalidated).toBe(true)
    })
  })

  test('invalidates pricing after resetting model prices', async () => {
    const user = userEvent.setup()
    const queryClient = renderWithQueryClient(
      <RatioSettingsCard
        modelDefaults={{
          ...emptyModelRatios,
          BillingMode: '{}',
          BillingExpr: '{}',
          ExposeRatioEnabled: false,
        }}
        groupDefaults={{
          GroupRatio: '{}',
          TopupGroupRatio: '{}',
          UserUsableGroups: '{}',
          GroupGroupRatio: '{}',
          AutoGroups: '[]',
          MaxTokenAutoGroups: 1,
          DefaultUseAutoGroup: false,
          GroupSpecialUsableGroup: '{}',
        }}
        toolPricesDefault='{}'
        visibleTabs={['models']}
      />
    )

    await user.click(
      await screen.findByRole('button', { name: 'Reset model ratios' })
    )
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['pricing'])?.isInvalidated).toBe(true)
    })
  })
})
