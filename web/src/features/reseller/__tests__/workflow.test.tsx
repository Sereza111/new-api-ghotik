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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { Reseller } from '..'

vi.mock('@/features/home/components/fortune-atmosphere', () => ({
  FortuneAtmosphere: () => <div data-testid='fortune-atmosphere' />,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

describe('reseller preview workflow', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('selects a gothic package and keeps the custom quota field in sync', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    const tenMillionPackage = screen.getByRole('radio', {
      name: '10M Tokens',
    })
    const fiftyMillionPackage = screen.getByRole('radio', {
      name: '50M Tokens',
    })

    expect(tenMillionPackage).toBeChecked()
    expect(fiftyMillionPackage).not.toBeChecked()

    await user.click(fiftyMillionPackage)

    expect(fiftyMillionPackage).toBeChecked()
    expect(screen.getByLabelText('Custom amount')).toHaveValue(50)
    expect(screen.getByText('$10.80')).toBeVisible()
  })

  test('normalizes and saves a custom reseller address', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    const endpointInput = screen.getByLabelText('Reseller endpoint')
    expect(endpointInput).toHaveValue('https://pugshop.ru')

    await user.clear(endpointInput)
    await user.type(endpointInput, 'edge.pugshop.ru/')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(endpointInput).toHaveValue('https://edge.pugshop.ru')
    expect(screen.getByText('https://edge.pugshop.ru')).toBeVisible()
    expect(window.localStorage.getItem('vl-reseller-endpoint')).toBe(
      'https://edge.pugshop.ru'
    )
  })

  test('rejects an address that is not HTTP or HTTPS', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    const endpointInput = screen.getByLabelText('Reseller endpoint')
    await user.clear(endpointInput)
    await user.type(endpointInput, 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a valid HTTP(S) address.'
    )
    expect(screen.getByText('https://pugshop.ru')).toBeVisible()
  })

  test('prepares a local demo key with the selected reseller address', async () => {
    const user = userEvent.setup()
    render(<Reseller />)

    const endpointInput = screen.getByLabelText('Reseller endpoint')
    await user.clear(endpointInput)
    await user.type(endpointInput, 'keys.pugshop.ru')
    await user.click(screen.getByRole('button', { name: 'Save' }))
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
    expect(screen.getAllByText('https://keys.pugshop.ru')).toHaveLength(2)
    expect(
      screen.getByText('This key is a preview and cannot send requests.')
    ).toBeVisible()
  })
})
