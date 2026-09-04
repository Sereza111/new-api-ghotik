import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { Reseller } from '..'

vi.mock('@/features/home/components/fortune-atmosphere', () => ({
  FortuneAtmosphere: () => <div data-testid='fortune-atmosphere' />,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}))

describe('reseller preview workflow', () => {
  test('selects a package and keeps the custom quota field in sync', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    const tenMillionPackage = screen.getByRole('button', { name: /10M/ })
    const fiftyMillionPackage = screen.getByRole('button', { name: /50M/ })

    expect(tenMillionPackage).toHaveAttribute('aria-pressed', 'true')
    expect(fiftyMillionPackage).toHaveAttribute('aria-pressed', 'false')

    await user.click(fiftyMillionPackage)

    expect(fiftyMillionPackage).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Custom amount')).toHaveValue(50)
    expect(screen.getByText('$10.80')).toBeVisible()
  })

  test('prepares a local demo key without presenting it as usable', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    await user.type(screen.getByLabelText('Client label'), 'North Studio')
    await user.clear(screen.getByLabelText('Custom amount'))
    await user.type(screen.getByLabelText('Custom amount'), '25')
    await user.click(screen.getByRole('button', { name: 'Prepare demo key' }))

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'North Studio' })
      ).toBeVisible()
    })
    expect(screen.getByText('25M / 25M')).toBeVisible()
    expect(screen.getAllByText('$5.40')).toHaveLength(2)
    expect(screen.getAllByText('https://example.com')).toHaveLength(2)
    expect(
      screen.getByText('This key is a preview and cannot send requests.')
    ).toBeVisible()
  })
})
