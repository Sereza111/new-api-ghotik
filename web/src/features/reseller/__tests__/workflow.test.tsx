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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { Reseller } from '..'
import type { ResellerKey } from '../types'

const resellerApi = vi.hoisted(() => ({
  createResellerKey: vi.fn(),
  deleteResellerKey: vi.fn(),
  getResellerConfig: vi.fn(),
  getResellerKeys: vi.fn(),
  purchaseResellerSubscription: vi.fn(),
  reissueResellerKey: vi.fn(),
  revealResellerKey: vi.fn(),
}))
const appApi = vi.hoisted(() => ({ getSelf: vi.fn() }))

vi.mock('../api', () => resellerApi)

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSelf: appApi.getSelf,
}))

vi.mock('@/features/home/components/fortune-atmosphere', () => ({
  FortuneAtmosphere: () => <div data-testid='fortune-atmosphere' />,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const existingKey: ResellerKey = {
  id: 41,
  client_label: 'Existing Studio',
  group: 'GPT',
  token_millions: 10,
  remaining_tokens: 9_000_000,
  used_tokens: 1_000_000,
  markup_percent: 80,
  term: 'unlimited',
  endpoint: 'https://pugshop.ru/v1',
  key: 'sk-****existing',
  created_time: 1_788_000_000,
  expired_time: -1,
  status: 1,
  cost: 0.8,
  client_price: 1.44,
}

const createdKey: ResellerKey = {
  id: 42,
  client_label: 'North Studio',
  group: 'GPT',
  token_millions: 25,
  remaining_tokens: 25_000_000,
  used_tokens: 0,
  markup_percent: 80,
  term: '30-days',
  endpoint: 'https://pugshop.ru/v1',
  key: 'sk-new-full-key',
  created_time: 1_788_000_100,
  expired_time: 1_790_592_100,
  status: 1,
  cost: 2,
  client_price: 3.6,
}

const activeSubscription = {
  active: true,
  expires_at: 1_790_592_100,
  list_price: 10,
  discount_percent: 20,
  price: 8,
  duration_days: 30,
}

const availableGroups = [
  { name: 'GPT', description: 'OpenAI models', ratio: 1 },
  { name: 'GROK', description: 'Grok models', ratio: 1 },
]

function renderReseller() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <Reseller />
    </QueryClientProvider>
  )
}

describe('reseller workflow', () => {
  beforeEach(() => {
    resellerApi.createResellerKey.mockReset()
    resellerApi.deleteResellerKey.mockReset()
    resellerApi.getResellerConfig.mockReset()
    resellerApi.getResellerKeys.mockReset()
    resellerApi.purchaseResellerSubscription.mockReset()
    resellerApi.reissueResellerKey.mockReset()
    resellerApi.revealResellerKey.mockReset()
    appApi.getSelf.mockReset()
    resellerApi.getResellerConfig.mockResolvedValue({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://pugshop.ru/v1',
      available_groups: availableGroups,
      subscription: activeSubscription,
    })
    resellerApi.getResellerKeys.mockResolvedValue([existingKey])
    resellerApi.createResellerKey.mockResolvedValue(createdKey)
    resellerApi.deleteResellerKey.mockResolvedValue(undefined)
    resellerApi.purchaseResellerSubscription.mockResolvedValue(
      activeSubscription
    )
    resellerApi.revealResellerKey.mockResolvedValue('sk-revealed-existing-key')
    resellerApi.reissueResellerKey.mockResolvedValue({
      ...existingKey,
      key: 'sk-reissued-full-key',
    })
    appApi.getSelf.mockResolvedValue({
      success: true,
      data: { id: 1, username: 'reseller', role: 1, quota: 1_000_000 },
    })
  })

  test('loads server pricing and keeps the selected package in sync', async () => {
    const user = userEvent.setup()
    renderReseller()

    const tenMillionPackage = await screen.findByRole('radio', {
      name: '10M Tokens',
    })
    const fiftyMillionPackage = screen.getByRole('radio', {
      name: '50M Tokens',
    })

    expect(tenMillionPackage).toBeChecked()
    expect(screen.getByText(/Base cost:/)).toHaveTextContent('$0.08')
    expect(screen.queryByText(/demo|preview/i)).not.toBeInTheDocument()

    await user.click(fiftyMillionPackage)

    expect(fiftyMillionPackage).toBeChecked()
    expect(screen.getByLabelText('Custom amount')).toHaveValue(50)
    expect(screen.getAllByText('$4.00').length).toBeGreaterThan(0)
  })

  test('issues a persistent key with the configured address and server price', async () => {
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('button', { name: 'Issue reseller key' })
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByText('OpenAI models'))
    await user.type(screen.getByLabelText('Client label'), 'North Studio')
    await user.clear(screen.getByLabelText('Custom amount'))
    await user.type(screen.getByLabelText('Custom amount'), '25')
    await user.selectOptions(
      screen.getByLabelText('Validity period'),
      '30-days'
    )
    await user.click(screen.getByRole('button', { name: 'Issue reseller key' }))

    await waitFor(() => {
      expect(resellerApi.createResellerKey).toHaveBeenCalledWith({
        client_label: 'North Studio',
        group: 'GPT',
        token_millions: 25,
        markup_percent: 80,
        term: '30-days',
        request_id: expect.any(String),
      })
    })
    expect(screen.getByRole('heading', { name: 'North Studio' })).toBeVisible()
    expect(screen.getByText('sk-new-full-key')).toBeVisible()
    expect(screen.getByText('25M / 25M')).toBeVisible()
    expect(screen.getAllByText('$3.60').length).toBeGreaterThan(0)
    await waitFor(() => expect(appApi.getSelf).toHaveBeenCalledOnce())
  })

  test('requires a concrete group before issuing a reseller key', async () => {
    const user = userEvent.setup()
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Issue reseller key' })
    )

    expect(
      await screen.findByText('Select a group for the reseller key.')
    ).toBeVisible()
    expect(resellerApi.createResellerKey).not.toHaveBeenCalled()
  })

  test('keeps the reseller catalog visible while issuance is subscription-gated', async () => {
    resellerApi.getResellerConfig.mockResolvedValue({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://pugshop.ru/v1',
      available_groups: availableGroups,
      subscription: { ...activeSubscription, active: false, expires_at: 0 },
    })
    const user = userEvent.setup()
    renderReseller()

    expect(
      await screen.findByRole('heading', {
        name: 'Unlock reseller key issuance',
      })
    ).toBeVisible()
    expect(screen.getByRole('radio', { name: '10M Tokens' })).toBeVisible()
    expect(screen.getByLabelText('Custom amount')).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Subscription required' })
    ).toBeDisabled()

    await user.click(
      screen.getByRole('button', { name: 'Purchase with balance' })
    )
    expect(
      screen.getByRole('heading', {
        name: 'Confirm reseller subscription purchase',
      })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm purchase' }))

    await waitFor(() => {
      expect(resellerApi.purchaseResellerSubscription).toHaveBeenCalledWith({
        request_id: expect.any(String),
      })
    })
    expect(
      await screen.findByRole('heading', {
        name: 'Reseller subscription active',
      })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Issue reseller key' })
    ).toBeEnabled()
    await waitFor(() => expect(appApi.getSelf).toHaveBeenCalledOnce())
  })

  test('does not sell access when no routing groups are available', async () => {
    resellerApi.getResellerConfig.mockResolvedValue({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://pugshop.ru/v1',
      available_groups: [],
      subscription: { ...activeSubscription, active: false, expires_at: 0 },
    })
    renderReseller()

    expect(
      await screen.findByText(
        'No routing groups are available for this account.'
      )
    ).toBeVisible()
    expect(screen.getByRole('radio', { name: '10M Tokens' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Purchase with balance' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Subscription required' })
    ).toBeDisabled()
    expect(resellerApi.purchaseResellerSubscription).not.toHaveBeenCalled()
  })

  test('does not trust an active subscription after its expiry time', async () => {
    resellerApi.getResellerConfig.mockResolvedValue({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://pugshop.ru/v1',
      available_groups: availableGroups,
      subscription: {
        ...activeSubscription,
        active: true,
        expires_at: Math.floor(Date.now() / 1000) - 1,
      },
    })
    renderReseller()

    expect(
      await screen.findByRole('heading', {
        name: 'Unlock reseller key issuance',
      })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Subscription required' })
    ).toBeDisabled()
  })

  test('reveals an existing masked key on demand', async () => {
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('heading', { name: 'Existing Studio' })
    expect(screen.getByText('sk-****existing')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Reveal key' }))

    expect(resellerApi.revealResellerKey).toHaveBeenCalledWith(41)
    expect(await screen.findByText('sk-revealed-existing-key')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeEnabled()
  })

  test('deletes a key only after warning that remaining quota is not refunded', async () => {
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('heading', { name: 'Existing Studio' })
    await user.click(screen.getByRole('button', { name: 'Delete key' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      'Its remaining token quota will be permanently discarded and will not be refunded.'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Delete key' }))

    await waitFor(() => {
      expect(resellerApi.deleteResellerKey).toHaveBeenCalledWith(41)
    })
    expect(
      screen.queryByRole('heading', { name: 'Existing Studio' })
    ).not.toBeInTheDocument()
  })

  test('reissues the secret while preserving the existing key package', async () => {
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('heading', { name: 'Existing Studio' })
    await user.click(screen.getByRole('button', { name: 'Reissue key' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      'Quota, group, and expiration will remain unchanged.'
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Reissue key' })
    )

    await waitFor(() => {
      expect(resellerApi.reissueResellerKey).toHaveBeenCalledWith(41)
    })
    expect(await screen.findByText('sk-reissued-full-key')).toBeVisible()
    expect(screen.getByText('9M / 10M')).toBeVisible()
    expect(screen.getByText('GPT')).toBeVisible()
  })

  test('keeps saved keys available when pricing cannot be loaded', async () => {
    resellerApi.getResellerConfig.mockRejectedValue(
      new Error('Pricing service unavailable')
    )
    renderReseller()

    expect(
      await screen.findByText('Failed to load reseller pricing')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Existing Studio' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Issue reseller key' })
    ).toBeNull()
  })

  test('shows a pending state while a key is being issued', async () => {
    let resolveCreate: ((value: ResellerKey) => void) | undefined
    resellerApi.createResellerKey.mockReturnValue(
      new Promise<ResellerKey>((resolve) => {
        resolveCreate = resolve
      })
    )
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('button', { name: 'Issue reseller key' })
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByText('OpenAI models'))
    await user.click(screen.getByRole('button', { name: 'Issue reseller key' }))

    expect(
      screen.getByRole('button', { name: 'Issuing key...' })
    ).toBeDisabled()

    resolveCreate?.(createdKey)
    expect(await screen.findByText('sk-new-full-key')).toBeVisible()
  })

  test('reuses an issuance id only while retrying the same draft', async () => {
    resellerApi.createResellerKey
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(createdKey)
    const user = userEvent.setup()
    renderReseller()

    const issueButton = await screen.findByRole('button', {
      name: 'Issue reseller key',
    })
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByText('OpenAI models'))
    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKey).toHaveBeenCalledTimes(1)
    )
    const firstRequestId =
      resellerApi.createResellerKey.mock.calls[0][0].request_id

    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKey).toHaveBeenCalledTimes(2)
    )
    expect(resellerApi.createResellerKey.mock.calls[1][0].request_id).toBe(
      firstRequestId
    )

    await user.clear(screen.getByLabelText('Custom amount'))
    await user.type(screen.getByLabelText('Custom amount'), '25')
    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKey).toHaveBeenCalledTimes(3)
    )
    expect(resellerApi.createResellerKey.mock.calls[2][0].request_id).not.toBe(
      firstRequestId
    )
  })
})
