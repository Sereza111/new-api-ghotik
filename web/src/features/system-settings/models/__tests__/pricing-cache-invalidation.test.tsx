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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { resetModelRatios, updateSystemOption } from '../../api'
import { RatioSettingsCard } from '../ratio-settings-card'
import { UpstreamRatioSync } from '../upstream-ratio-sync'

vi.mock('../../api', () => ({
  fetchUpstreamRatios: vi.fn(),
  getUpstreamChannels: vi.fn(),
  resetModelRatios: vi.fn(),
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
    onSelectValue: (
      model: string,
      ratioType: 'model_ratio',
      value: number,
      sourceName: string
    ) => void
  }) => (
    <button
      type='button'
      onClick={() =>
        props.onSelectValue('gpt-test', 'model_ratio', 2, 'upstream')
      }
    >
      Select upstream price
    </button>
  ),
}))

vi.mock('../channel-selector-dialog', () => ({
  ChannelSelectorDialog: () => null,
}))

vi.mock('../conflict-confirm-dialog', () => ({
  ConflictConfirmDialog: () => null,
}))

const emptyModelRatios = {
  ModelPrice: '{}',
  ModelReferencePrice: '{}',
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
    vi.mocked(updateSystemOption).mockResolvedValue({
      success: true,
      message: '',
    })
    vi.mocked(resetModelRatios).mockResolvedValue({
      success: true,
      message: '',
    })
  })

  test('invalidates pricing after applying an upstream price sync', async () => {
    const user = userEvent.setup()
    const queryClient = renderWithQueryClient(
      <UpstreamRatioSync modelRatios={emptyModelRatios} />
    )

    await user.click(
      screen.getByRole('button', { name: 'Select upstream price' })
    )
    await user.click(screen.getByRole('button', { name: 'Apply Sync' }))

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

    await user.click(screen.getByRole('button', { name: 'Reset model ratios' }))
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['pricing'])?.isInvalidated).toBe(true)
    })
  })
})
