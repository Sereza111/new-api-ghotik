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
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import { FortuneWheel } from '../fortune-wheel'

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
})

describe('gothic fortune wheel', () => {
  test('animates only the inner rotor and supports reduced motion', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <FortuneWheel />
      </I18nextProvider>
    )

    const frame = screen.getByRole('figure', {
      name: 'Gothic Wheel of Fortune',
    })
    const rotor = screen.getByTestId('fortune-wheel-rotor')

    expect(frame).not.toHaveClass('fortune-wheel-rotor')
    expect(rotor).toHaveClass('fortune-wheel-rotor')
    expect(rotor).toHaveClass('motion-reduce:animate-none')
  })
})
