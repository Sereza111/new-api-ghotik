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
  adjustResellerKeyQuota: vi.fn(),
  createResellerKeyBatch: vi.fn(),
  createResellerKey: vi.fn(),
  deleteResellerKey: vi.fn(),
  getResellerConfig: vi.fn(),
  getResellerKeys: vi.fn(),
  purchaseResellerSubscription: vi.fn(),
  reissueResellerKey: vi.fn(),
  revealResellerKey: vi.fn(),
}))
const appApi = vi.hoisted(() => ({ getSelf: vi.fn() }))
const chartRender = vi.hoisted(() => vi.fn())

vi.mock('../api', () => resellerApi)

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSelf: appApi.getSelf,
}))

vi.mock('@/features/home/components/fortune-atmosphere', () => ({
  FortuneAtmosphere: () => <div data-testid='fortune-atmosphere' />,
}))

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: unknown) => {
    chartRender(props)
    return <div data-testid='reseller-revenue-chart' />
  },
}))

vi.mock('@/lib/use-chart-theme', () => ({
  useChartTheme: () => ({ resolvedTheme: 'dark', themeReady: true }),
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
  base_cost_per_million: 0.08,
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
  base_cost_per_million: 0.08,
}

const activeSubscription = {
  active: true,
  expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
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
    resellerApi.adjustResellerKeyQuota.mockReset()
    resellerApi.createResellerKeyBatch.mockReset()
    resellerApi.createResellerKey.mockReset()
    resellerApi.deleteResellerKey.mockReset()
    resellerApi.getResellerConfig.mockReset()
    resellerApi.getResellerKeys.mockReset()
    resellerApi.purchaseResellerSubscription.mockReset()
    resellerApi.reissueResellerKey.mockReset()
    resellerApi.revealResellerKey.mockReset()
    appApi.getSelf.mockReset()
    chartRender.mockReset()
    resellerApi.getResellerConfig.mockResolvedValue({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://reseler.errorclub.club/v1',
      available_groups: availableGroups,
      subscription: activeSubscription,
    })
    resellerApi.getResellerKeys.mockResolvedValue([existingKey])
    resellerApi.createResellerKeyBatch.mockResolvedValue([createdKey])
    resellerApi.deleteResellerKey.mockResolvedValue(undefined)
    resellerApi.purchaseResellerSubscription.mockResolvedValue(
      activeSubscription
    )
    resellerApi.revealResellerKey.mockResolvedValue('sk-revealed-existing-key')
    resellerApi.reissueResellerKey.mockResolvedValue({
      ...existingKey,
      key: 'sk-reissued-full-key',
    })
    resellerApi.adjustResellerKeyQuota.mockImplementation(
      async (
        _id: number,
        request: { mode: string; token_millions: number }
      ) => {
        const usedMillions = existingKey.used_tokens / 1_000_000
        let totalMillions = existingKey.token_millions
        if (request.mode === 'add') totalMillions += request.token_millions
        if (request.mode === 'subtract') {
          totalMillions -= request.token_millions
        }
        if (request.mode === 'set') totalMillions = request.token_millions
        return {
          ...existingKey,
          token_millions: totalMillions,
          remaining_tokens: (totalMillions - usedMillions) * 1_000_000,
        }
      }
    )
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

  test('links the client portal and summarizes reseller revenue', async () => {
    renderReseller()

    const portalLink = await screen.findByRole('link', {
      name: 'Open reseller panel',
    })
    expect(portalLink).toHaveAttribute('href', 'https://reseler.errorclub.club')
    expect(screen.getAllByText('Issued key value').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Estimated profit').length).toBeGreaterThan(0)
    expect(screen.getByTestId('reseller-revenue-chart')).toBeVisible()
    expect(chartRender).toHaveBeenCalled()
  })

  test('groups keys by quota and filters the key vault', async () => {
    const twoMillionKey: ResellerKey = {
      ...existingKey,
      id: 43,
      client_label: 'Two Million Client',
      token_millions: 2,
      remaining_tokens: 2_000_000,
      used_tokens: 0,
      status: 2,
      cost: 0.16,
      client_price: 0.29,
    }
    resellerApi.getResellerKeys.mockResolvedValue([existingKey, twoMillionKey])
    const user = userEvent.setup()
    renderReseller()

    expect(await screen.findByRole('button', { name: /10M/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /2M/ })).toBeVisible()

    await user.type(
      screen.getByRole('searchbox', { name: 'Search reseller keys' }),
      'Two Million'
    )

    expect(
      screen.queryByRole('heading', { name: 'Existing Studio' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Two Million Client' })
    ).toBeVisible()
    expect(screen.getByText('Showing 1 of 2 keys')).toBeVisible()
  })

  test('sets the total quota of an issued reseller key', async () => {
    const user = userEvent.setup()
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Adjust quota' })
    )
    const quotaDialog = screen.getByRole('dialog')
    expect(
      within(quotaDialog).getByRole('heading', {
        name: 'Adjust quota for "Existing Studio"',
      })
    ).toBeVisible()
    expect(within(quotaDialog).getByText('9M')).toBeVisible()
    expect(within(quotaDialog).getByText('10M')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Set total quota' }))
    await user.type(screen.getByLabelText('Million tokens'), '5')
    await user.click(screen.getByRole('button', { name: 'Update quota' }))

    await waitFor(() => {
      expect(resellerApi.adjustResellerKeyQuota).toHaveBeenCalledWith(
        existingKey.id,
        {
          mode: 'set',
          token_millions: 5,
          expected_total_millions: 10,
          request_id: expect.any(String),
        }
      )
    })
    expect(await screen.findByText('4M / 5M')).toBeVisible()
  })

  test('adds paid quota to an issued reseller key', async () => {
    const user = userEvent.setup()
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Adjust quota' })
    )
    expect(
      screen.getByText(
        'Adding quota charges your balance. Reducing quota does not refund funds.'
      )
    ).toBeVisible()
    await user.type(screen.getByLabelText('Million tokens'), '2')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const paymentConfirmation = screen.getByRole('alert')
    expect(
      within(paymentConfirmation).getByText('Confirm paid quota increase')
    ).toBeVisible()
    expect(within(paymentConfirmation).getByText('2M')).toBeVisible()
    expect(within(paymentConfirmation).getByText('$0.16')).toBeVisible()
    expect(resellerApi.adjustResellerKeyQuota).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm purchase' }))

    await waitFor(() => {
      expect(resellerApi.adjustResellerKeyQuota).toHaveBeenCalledWith(
        existingKey.id,
        {
          mode: 'add',
          token_millions: 2,
          expected_total_millions: 10,
          request_id: expect.any(String),
        }
      )
    })
    expect(await screen.findByText('11M / 12M')).toBeVisible()
    await waitFor(() => expect(appApi.getSelf).toHaveBeenCalledOnce())
  })

  test('reconciles an ambiguous error and reuses the exact paid request', async () => {
    const user = userEvent.setup()
    resellerApi.adjustResellerKeyQuota
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({
        ...existingKey,
        token_millions: 12,
        remaining_tokens: 11_000_000,
      })
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Adjust quota' })
    )
    await user.type(screen.getByLabelText('Million tokens'), '2')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Confirm purchase' }))

    await waitFor(() => {
      expect(resellerApi.adjustResellerKeyQuota).toHaveBeenCalledTimes(1)
      expect(resellerApi.getResellerKeys.mock.calls.length).toBeGreaterThan(1)
    })
    const firstRequest = resellerApi.adjustResellerKeyQuota.mock.calls[0][1]

    await user.click(screen.getByRole('button', { name: 'Confirm purchase' }))

    await waitFor(() => {
      expect(resellerApi.adjustResellerKeyQuota).toHaveBeenCalledTimes(2)
    })
    expect(resellerApi.adjustResellerKeyQuota.mock.calls[1][1]).toEqual(
      firstRequest
    )
  })

  test('subtracts only unused quota from an issued reseller key', async () => {
    const user = userEvent.setup()
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Adjust quota' })
    )
    await user.click(screen.getByRole('button', { name: 'Subtract quota' }))
    await user.type(screen.getByLabelText('Million tokens'), '2')
    await user.click(screen.getByRole('button', { name: 'Update quota' }))

    await waitFor(() => {
      expect(resellerApi.adjustResellerKeyQuota).toHaveBeenCalledWith(
        existingKey.id,
        {
          mode: 'subtract',
          token_millions: 2,
          expected_total_millions: 10,
          request_id: expect.any(String),
        }
      )
    })
    expect(await screen.findByText('7M / 8M')).toBeVisible()
  })

  test('prevents quota adjustments beyond the purchased package', async () => {
    const user = userEvent.setup()
    renderReseller()

    await user.click(
      await screen.findByRole('button', { name: 'Adjust quota' })
    )
    const amountInput = screen.getByLabelText('Million tokens')
    await user.type(amountInput, '991')

    expect(amountInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Update quota' })).toBeDisabled()
    expect(resellerApi.adjustResellerKeyQuota).not.toHaveBeenCalled()
  })

  test('issues a persistent key with the configured address and server price', async () => {
    resellerApi.getResellerKeys
      .mockResolvedValueOnce([existingKey])
      .mockResolvedValue([createdKey, existingKey])
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
      expect(resellerApi.createResellerKeyBatch).toHaveBeenCalledWith({
        client_label: 'North Studio',
        group: 'GPT',
        token_millions: 25,
        quantity: 1,
        markup_percent: 80,
        term: '30-days',
        request_id: expect.any(String),
      })
    })
    const resultDialog = screen.getByRole('dialog', {
      name: 'Reseller keys issued',
    })
    expect(resultDialog).toBeVisible()
    expect(within(resultDialog).getByText('sk-new-full-key')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.getByRole('heading', { name: 'North Studio' })).toBeVisible()
    expect(screen.getByText('sk-new-full-key')).toBeVisible()
    expect(screen.getByText('25M / 25M')).toBeVisible()
    expect(screen.getAllByText('$3.60').length).toBeGreaterThan(0)
    await waitFor(() => expect(appApi.getSelf).toHaveBeenCalledOnce())
  })

  test('issues, copies, downloads, and caches a reseller key batch', async () => {
    const createdBatch = Array.from({ length: 3 }, (_, index) => ({
      ...createdKey,
      id: createdKey.id + index,
      client_label: `FunPay #${index + 1}`,
      token_millions: 10,
      remaining_tokens: 10_000_000,
      term: 'unlimited' as const,
      key: `sk-batch-key-${index + 1}`,
      cost: 0.8,
      client_price: 1.44,
    }))
    resellerApi.createResellerKeyBatch.mockResolvedValue(createdBatch)
    resellerApi.getResellerKeys
      .mockResolvedValueOnce([existingKey])
      .mockResolvedValue([...createdBatch, existingKey])
    const createObjectURL = vi.fn(() => 'blob:reseller-keys')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const clipboardWrite = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue()
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('button', { name: 'Issue reseller key' })
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByText('OpenAI models'))
    await user.type(screen.getByLabelText('Client label'), 'FunPay')
    await user.clear(screen.getByLabelText('Number of keys'))
    await user.type(screen.getByLabelText('Number of keys'), '3')

    expect(screen.getByText('Total cost').nextSibling).toHaveTextContent(
      '$2.40'
    )
    expect(
      screen.getByText('Total client value').nextSibling
    ).toHaveTextContent('$4.32')
    await user.click(screen.getByRole('button', { name: 'Issue 3 keys' }))

    await waitFor(() => {
      expect(resellerApi.createResellerKeyBatch).toHaveBeenCalledWith({
        client_label: 'FunPay',
        group: 'GPT',
        token_millions: 10,
        quantity: 3,
        markup_percent: 80,
        term: 'unlimited',
        request_id: expect.any(String),
      })
    })
    const resultDialog = await screen.findByRole('dialog')
    expect(
      within(resultDialog).getByRole('heading', {
        name: 'Reseller keys issued',
      })
    ).toBeVisible()
    for (const item of createdBatch) {
      expect(within(resultDialog).getByText(item.key)).toBeVisible()
    }

    await user.click(
      within(resultDialog).getByRole('button', { name: 'Copy all keys' })
    )
    expect(clipboardWrite).toHaveBeenCalledWith(
      createdBatch.map((item) => item.key).join('\n')
    )

    await user.click(
      within(resultDialog).getByRole('button', { name: 'Download TXT' })
    )
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:reseller-keys')

    await user.click(within(resultDialog).getByRole('button', { name: 'Done' }))
    for (const item of createdBatch) {
      expect(
        await screen.findByRole('heading', { name: item.client_label })
      ).toBeVisible()
      expect(screen.getByText(item.key)).toBeVisible()
    }

    anchorClick.mockRestore()
    clipboardWrite.mockRestore()
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  test('keeps the issue action readable while the quantity field is empty', async () => {
    const user = userEvent.setup()
    renderReseller()

    await screen.findByRole('button', { name: 'Issue reseller key' })
    await user.clear(screen.getByLabelText('Number of keys'))

    expect(
      screen.getByRole('button', { name: 'Issue reseller key' })
    ).toBeVisible()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
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
    expect(resellerApi.createResellerKeyBatch).not.toHaveBeenCalled()
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
    let resolveCreate: ((value: ResellerKey[]) => void) | undefined
    resellerApi.createResellerKeyBatch.mockReturnValue(
      new Promise<ResellerKey[]>((resolve) => {
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

    resolveCreate?.([createdKey])
    expect(await screen.findByText('sk-new-full-key')).toBeVisible()
  })

  test('reuses an issuance id only while retrying the same draft', async () => {
    resellerApi.createResellerKeyBatch
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce([createdKey])
    const user = userEvent.setup()
    renderReseller()

    const issueButton = await screen.findByRole('button', {
      name: 'Issue reseller key',
    })
    await user.click(screen.getByRole('combobox', { name: 'Group' }))
    await user.click(screen.getByText('OpenAI models'))
    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKeyBatch).toHaveBeenCalledTimes(1)
    )
    const firstRequestId =
      resellerApi.createResellerKeyBatch.mock.calls[0][0].request_id

    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKeyBatch).toHaveBeenCalledTimes(2)
    )
    expect(resellerApi.createResellerKeyBatch.mock.calls[1][0].request_id).toBe(
      firstRequestId
    )

    await user.clear(screen.getByLabelText('Custom amount'))
    await user.type(screen.getByLabelText('Custom amount'), '25')
    await user.click(issueButton)
    await waitFor(() =>
      expect(resellerApi.createResellerKeyBatch).toHaveBeenCalledTimes(3)
    )
    expect(
      resellerApi.createResellerKeyBatch.mock.calls[2][0].request_id
    ).not.toBe(firstRequestId)
  })
})
