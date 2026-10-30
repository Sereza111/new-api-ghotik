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
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { useTopNavLinks } from '../use-top-nav-links'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: { docs_link: 'https://external.example/docs' },
  }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { user: { id: 1 } } }),
}))

vi.mock('@/lib/nav-modules', () => ({
  parseHeaderNavModulesFromStatus: () => ({
    home: true,
    console: true,
    pricing: { enabled: true, requireAuth: false },
    rankings: { enabled: false, requireAuth: false },
    docs: true,
    about: true,
  }),
}))

describe('useTopNavLinks', () => {
  test('uses compact models label and internal docs while exposing service status', () => {
    const { result } = renderHook(() => useTopNavLinks())

    expect(result.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Models', href: '/pricing' }),
        expect.objectContaining({ title: 'Docs', href: '/docs' }),
        expect.objectContaining({
          title: 'Service Status',
          href: '/service-status',
        }),
        expect.objectContaining({ title: 'About', href: '/about' }),
      ])
    )
    expect(result.current).not.toContainEqual(
      expect.objectContaining({ href: 'https://external.example/docs' })
    )
  })
})
