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
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { updateResellerCommercialSettings } from '../../api'
import { SettingsPageProvider } from '../../components/settings-page-context'
import { ResellerPricingSection } from '../reseller-pricing-section'
import { BILLING_SECTION_IDS } from '../section-registry'

vi.mock('../../api', () => ({
  updateResellerCommercialSettings: vi.fn(),
}))

vi.mock('../../components/form-navigation-guard', () => ({
  FormNavigationGuard: () => null,
}))

const defaultValues = {
  reseller_setting: {
    base_cost_per_million: 0.12,
    endpoint: 'https://pugshop.ru/v1',
    subscription_price: 10,
    subscription_discount_percent: 0,
    subscription_duration_days: 30,
  },
}

function SettingsTestHarness(props: { children: ReactNode }) {
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SettingsPageProvider
        actionsContainer={actionsContainer}
        suppressSectionHeader={false}
      >
        <div ref={setActionsContainer} />
        {props.children}
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

function renderSection() {
  return render(
    <SettingsTestHarness>
      <ResellerPricingSection defaultValues={defaultValues} />
    </SettingsTestHarness>
  )
}

describe('reseller pricing settings', () => {
  beforeEach(() => {
    vi.mocked(updateResellerCommercialSettings).mockResolvedValue({
      success: true,
      message: '',
    })
  })

  test('registers the reseller pricing section and shows saved values', async () => {
    renderSection()

    expect(BILLING_SECTION_IDS).toContain('reseller-pricing')
    expect(
      screen.getByRole('heading', { name: 'Reseller pricing' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('spinbutton', {
        name: 'Base cost per 1M tokens (USD)',
      })
    ).toHaveValue(0.12)
    expect(
      screen.getByRole('textbox', { name: 'Reseller endpoint' })
    ).toHaveValue('https://pugshop.ru/v1')
    expect(
      screen.getByRole('spinbutton', { name: 'Subscription price (USD)' })
    ).toHaveValue(10)
    expect(
      screen.getByRole('spinbutton', { name: 'Subscription discount (%)' })
    ).toHaveValue(0)
    expect(
      screen.getByRole('spinbutton', { name: 'Subscription duration (days)' })
    ).toHaveValue(30)
    expect(
      await screen.findByRole('button', { name: 'Save Changes' })
    ).toBeDisabled()
  })

  test('rejects invalid cost and endpoint without sending updates', async () => {
    const user = userEvent.setup()
    renderSection()

    const costInput = screen.getByRole('spinbutton', {
      name: 'Base cost per 1M tokens (USD)',
    })
    const endpointInput = screen.getByRole('textbox', {
      name: 'Reseller endpoint',
    })

    fireEvent.change(costInput, { target: { value: '0' } })
    await user.clear(endpointInput)
    await user.type(endpointInput, 'ftp://example.com?token=secret')
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    expect(
      await screen.findByText('Base cost must be greater than 0')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Enter a valid HTTP or HTTPS URL without credentials, query parameters, or fragments'
      )
    ).toBeInTheDocument()
    expect(updateResellerCommercialSettings).not.toHaveBeenCalled()
  })

  test('rejects a base cost above the server limit', async () => {
    const user = userEvent.setup()
    renderSection()

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Base cost per 1M tokens (USD)',
      }),
      { target: { value: '1000000.01' } }
    )
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    expect(
      await screen.findByText('Base cost must not exceed 1,000,000 USD')
    ).toBeInTheDocument()
    expect(updateResellerCommercialSettings).not.toHaveBeenCalled()
  })

  test('rejects sub-cent base costs', async () => {
    const user = userEvent.setup()
    renderSection()

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'Base cost per 1M tokens (USD)',
      }),
      { target: { value: '0.011' } }
    )
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    expect(
      await screen.findByText('Use no more than two decimal places.')
    ).toBeInTheDocument()
    expect(updateResellerCommercialSettings).not.toHaveBeenCalled()
  })

  test('rejects subscription values outside the server limits', async () => {
    const user = userEvent.setup()
    renderSection()

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Subscription price (USD)' }),
      { target: { value: '0' } }
    )
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Subscription discount (%)' }),
      { target: { value: '91' } }
    )
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Subscription duration (days)' }),
      { target: { value: '3651' } }
    )
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    expect(
      await screen.findByText('Subscription price must be at least 0.01 USD')
    ).toBeInTheDocument()
    expect(screen.getByText('Discount must not exceed 90%')).toBeInTheDocument()
    expect(
      screen.getByText('Duration must not exceed 3650 days')
    ).toBeInTheDocument()
    expect(updateResellerCommercialSettings).not.toHaveBeenCalled()
  })

  test('saves the complete reseller settings tuple atomically', async () => {
    const user = userEvent.setup()
    const invalidateQueries = vi.spyOn(
      QueryClient.prototype,
      'invalidateQueries'
    )
    renderSection()

    const costInput = screen.getByRole('spinbutton', {
      name: 'Base cost per 1M tokens (USD)',
    })
    const endpointInput = screen.getByRole('textbox', {
      name: 'Reseller endpoint',
    })
    const subscriptionPriceInput = screen.getByRole('spinbutton', {
      name: 'Subscription price (USD)',
    })
    const discountInput = screen.getByRole('spinbutton', {
      name: 'Subscription discount (%)',
    })
    const durationInput = screen.getByRole('spinbutton', {
      name: 'Subscription duration (days)',
    })

    fireEvent.change(costInput, { target: { value: '0.25' } })
    await user.clear(endpointInput)
    await user.type(endpointInput, 'https://reseller.example.com/v1')
    fireEvent.change(subscriptionPriceInput, { target: { value: '25' } })
    fireEvent.change(discountInput, { target: { value: '15' } })
    fireEvent.change(durationInput, { target: { value: '60' } })
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    await waitFor(() =>
      expect(updateResellerCommercialSettings).toHaveBeenCalledOnce()
    )
    expect(updateResellerCommercialSettings).toHaveBeenCalledWith({
      base_cost_per_million: 0.25,
      endpoint: 'https://reseller.example.com/v1',
      subscription_price: 25,
      subscription_discount_percent: 15,
      subscription_duration_days: 60,
    })
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['reseller', 'config'],
      })
    )
  })

  test('keeps rejected values dirty when the server refuses an update', async () => {
    const user = userEvent.setup()
    vi.mocked(updateResellerCommercialSettings).mockResolvedValue({
      success: false,
      message: 'Reseller price was rejected',
    })
    renderSection()

    const costInput = screen.getByRole('spinbutton', {
      name: 'Base cost per 1M tokens (USD)',
    })
    fireEvent.change(costInput, { target: { value: '0.25' } })
    const saveButton = await screen.findByRole('button', {
      name: 'Save Changes',
    })
    await user.click(saveButton)

    await waitFor(() =>
      expect(updateResellerCommercialSettings).toHaveBeenCalledOnce()
    )
    expect(costInput).toHaveValue(0.25)
    expect(saveButton).toBeEnabled()
  })
})
