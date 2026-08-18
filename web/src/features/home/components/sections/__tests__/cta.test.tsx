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
import { createInstance } from 'i18next'
import type { ComponentProps, PropsWithChildren } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: ComponentProps<'a'> & { to: string }) => {
    const { to, ...anchorProps } = props
    return <a href={to} {...anchorProps} />
  },
}))

vi.mock('@/components/animate-in-view', () => ({
  AnimateInView: (props: PropsWithChildren) => <div>{props.children}</div>,
}))

const i18n = createInstance()
let CTA: typeof import('../cta').CTA

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
  CTA = (await import('../cta')).CTA
})

function renderCTA(isAuthenticated: boolean) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CTA isAuthenticated={isAuthenticated} />
    </I18nextProvider>
  )
}

describe('landing page call to action', () => {
  test('offers registration and pricing links to visitors', () => {
    renderCTA(false)

    expect(screen.getByRole('button', { name: 'Get Started' })).toHaveAttribute(
      'href',
      '/sign-up'
    )
    expect(
      screen.getByRole('button', { name: 'View Pricing' })
    ).toHaveAttribute('href', '/pricing')
  })

  test('stays hidden after the visitor is authenticated', () => {
    const { container } = renderCTA(true)

    expect(container).toBeEmptyDOMElement()
  })
})
