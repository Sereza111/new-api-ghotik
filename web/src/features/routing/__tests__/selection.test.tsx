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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { SourceSelector } from '../source-selector'
import type { RoutingFamily } from '../types'

const gptFamily: RoutingFamily = {
  id: 'gpt',
  label: 'GPT',
  selected_source_id: '',
  default_source_id: '',
  fallback_description: 'Server fallback copy',
  sources: [
    {
      id: 'standard',
      label: 'GPT Team/Plus',
      description: 'Standard GPT source',
      price_multiplier: 1,
      model_count: 8,
      is_default: true,
    },
    {
      id: 'premium',
      label: 'GPT Pro/Enterprise',
      description: 'Priority GPT source',
      price_multiplier: 2.7,
      model_count: 5,
      is_default: false,
    },
  ],
}

describe('routing source selection', () => {
  test('keeps API key routing until the user chooses an account source', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SourceSelector
        family={gptFamily}
        disabled={false}
        saving={false}
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('combobox', { name: 'Source for GPT' })
    expect(trigger).toHaveTextContent('Automatic (API key default)')
    expect(screen.getByText('API key routing')).toBeVisible()

    await user.click(trigger)
    await user.click(
      screen.getByRole('option', { name: /GPT Pro\/Enterprise/ })
    )

    expect(onChange).toHaveBeenCalledWith('premium')

    await user.click(screen.getByRole('button', { name: 'Fallback behavior' }))
    expect(
      screen.getByText('Unavailable models use the API key default route.')
    ).toBeVisible()
  })

  test('returns null when the user resets an explicit source to API key routing', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SourceSelector
        family={{ ...gptFamily, selected_source_id: 'premium' }}
        disabled={false}
        saving={false}
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('combobox', { name: 'Source for GPT' })
    expect(trigger).toHaveTextContent('GPT Pro/Enterprise')
    expect(screen.getByText('Priority GPT source')).toBeVisible()
    expect(screen.getByText('×2.7')).toBeVisible()
    expect(screen.queryByText('Server fallback copy')).not.toBeInTheDocument()

    const fallbackDisclosure = screen.getByRole('button', {
      name: 'Fallback behavior',
    })
    expect(fallbackDisclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(fallbackDisclosure)
    expect(fallbackDisclosure).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByText('Unavailable models use the API key default route.')
    ).toBeVisible()

    await user.click(trigger)
    await user.click(
      screen.getByRole('option', { name: 'Automatic (API key default)' })
    )

    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('disables the selector and exposes progress while the preference is saving', () => {
    render(
      <SourceSelector family={gptFamily} disabled saving onChange={vi.fn()} />
    )

    expect(
      screen.getByRole('combobox', { name: 'Source for GPT' })
    ).toBeDisabled()
    expect(
      screen.getByRole('status', { name: 'Saving source preference' })
    ).toBeVisible()
  })
})
