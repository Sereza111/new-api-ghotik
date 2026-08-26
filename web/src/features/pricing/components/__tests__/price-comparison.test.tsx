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

import { PriceComparison } from '../price-comparison'

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {
      en: {
        translation: {
          'Official price': 'Official price',
          'Our price': 'Our price',
          '-{{discount}}%': '-{{discount}}%',
        },
      },
    },
  })
})

describe('price comparison', () => {
  test('shows current price, official price, and calculated discount', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PriceComparison
          currentPrices={['$0.1', '$0.6']}
          referencePrices={['$4', '$20']}
          discountPercent={98}
          unit='/ 1M tokens'
        />
      </I18nextProvider>
    )

    expect(screen.getByLabelText('Our price')).toHaveTextContent('$0.1/$0.6')
    expect(screen.getByLabelText('Official price')).toHaveTextContent('$4/$20')
    expect(screen.getByText('-98%')).toBeVisible()
    expect(screen.getByText('/ 1M tokens')).toBeVisible()
  })
})
