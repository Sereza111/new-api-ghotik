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
import { describe, expect, test, vi } from 'vitest'

import { SystemBrand } from '../system-brand'

vi.mock('@tanstack/react-router', () => ({
  Link: (
    props: { children: React.ReactNode; to: string } & Record<string, unknown>
  ) => {
    const { children, to, ...linkProps } = props
    return (
      <a href={to} {...linkProps}>
        {children}
      </a>
    )
  },
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { system_name: 'New API', version: 'v1.0.0' },
  }),
}))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({ logo: '/configured-logo.png' }),
}))

describe('SystemBrand', () => {
  test('keeps attribution while making the VL mark prominent in the app header', () => {
    render(<SystemBrand variant='inline' />)

    const mark = document.querySelector('[data-slot="vl-brand-mark"]')
    const vlLogo = screen.getByAltText('VL')

    expect(mark).toHaveClass('size-8')
    expect(mark).toHaveClass('shrink-0')
    expect(vlLogo).toHaveClass('size-6')
    expect(screen.getByText('VL')).toBeVisible()
    expect(screen.getByText('New API')).toBeVisible()
  })
})
