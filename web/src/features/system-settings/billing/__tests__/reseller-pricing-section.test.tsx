import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { updateSystemOption } from '../../api'
import { SettingsPageProvider } from '../../components/settings-page-context'
import { ResellerPricingSection } from '../reseller-pricing-section'
import { BILLING_SECTION_IDS } from '../section-registry'

vi.mock('../../api', () => ({
  updateSystemOption: vi.fn(),
}))

vi.mock('../../components/form-navigation-guard', () => ({
  FormNavigationGuard: () => null,
}))

const defaultValues = {
  reseller_setting: {
    base_cost_per_million: 0.12,
    endpoint: 'https://pugshop.ru/v1',
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
    vi.mocked(updateSystemOption).mockResolvedValue({
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
    expect(updateSystemOption).not.toHaveBeenCalled()
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
    expect(updateSystemOption).not.toHaveBeenCalled()
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
    expect(updateSystemOption).not.toHaveBeenCalled()
  })

  test('saves changed values with the reseller option keys', async () => {
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

    fireEvent.change(costInput, { target: { value: '0.25' } })
    await user.clear(endpointInput)
    await user.type(endpointInput, 'https://reseller.example.com/v1')
    await user.click(
      await screen.findByRole('button', { name: 'Save Changes' })
    )

    await waitFor(() => expect(updateSystemOption).toHaveBeenCalledTimes(2))
    expect(updateSystemOption).toHaveBeenCalledWith({
      key: 'reseller_setting.base_cost_per_million',
      value: '0.25',
    })
    expect(updateSystemOption).toHaveBeenCalledWith({
      key: 'reseller_setting.endpoint',
      value: 'https://reseller.example.com/v1',
    })
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['reseller', 'config'],
      })
    )
  })

  test('keeps rejected values dirty when the server refuses an update', async () => {
    const user = userEvent.setup()
    vi.mocked(updateSystemOption).mockResolvedValue({
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

    await waitFor(() => expect(updateSystemOption).toHaveBeenCalledOnce())
    expect(costInput).toHaveValue(0.25)
    expect(saveButton).toBeEnabled()
  })
})
