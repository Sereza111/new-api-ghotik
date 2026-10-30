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
import type { ComponentProps } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { DefaultAboutContent } from '../index'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: ComponentProps<'a'> & { to: string }) => {
    const { to, ...anchorProps } = props
    return <a href={to} {...anchorProps} />
  },
}))

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
})

describe('default about content', () => {
  test('presents VL and keeps the source project attribution available', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DefaultAboutContent />
      </I18nextProvider>
    )

    expect(screen.getByRole('heading', { name: 'VL API' })).toBeVisible()
    expect(screen.queryByText('No About Content Set')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Source project' })
    ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
    expect(screen.getByText('QuantumNous')).toBeVisible()
  })
})
