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
import type { PropsWithChildren } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { AuthLayout } from '@/features/auth/auth-layout'

import { Home } from '..'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: PropsWithChildren) => children,
}))
vi.mock('@/components/layout/components/footer', () => ({
  Footer: () => null,
}))
vi.mock('@/components/rich-content', () => ({ RichContent: () => null }))
vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { user: null } }),
}))
vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    systemName: 'VL API',
    logo: '/logo.png',
    loading: false,
  }),
}))
vi.mock('../hooks', () => ({
  useHomePageContent: () => ({ content: '', isLoaded: true, isUrl: false }),
}))
vi.mock('../components', () => ({
  CTA: () => null,
  Hero: () => null,
  HowItWorks: () => null,
  PlatformOverview: () => null,
}))
vi.mock('../components/fortune-wheel', () => ({ FortuneWheel: () => null }))
vi.mock('../components/fortune-atmosphere', () => ({
  FortuneAtmosphere: () => (
    <canvas data-testid='fortune-atmosphere' aria-hidden='true' />
  ),
}))

describe('fortune atmosphere placement', () => {
  test('mounts one atmosphere layer on the default home', () => {
    const { container } = render(<Home />)
    const surface = container.querySelector('.fortune-atmosphere-surface')

    expect(surface).toContainElement(screen.getByTestId('fortune-atmosphere'))
    expect(screen.getAllByTestId('fortune-atmosphere')).toHaveLength(1)
  })

  test('mounts one atmosphere layer on auth pages', () => {
    const { container } = render(
      <AuthLayout>
        <div>form</div>
      </AuthLayout>
    )
    const surface = container.querySelector('[data-auth-layout="gothic"]')

    expect(surface).toContainElement(screen.getByTestId('fortune-atmosphere'))
    expect(screen.getAllByTestId('fortune-atmosphere')).toHaveLength(1)
  })
})
