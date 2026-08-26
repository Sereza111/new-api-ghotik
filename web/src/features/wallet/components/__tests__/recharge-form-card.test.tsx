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
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { PAYMENT_TYPES } from '../../constants'
import type { TopupInfo } from '../../types'
import { RechargeFormCard } from '../recharge-form-card'

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
})

const topupInfo: TopupInfo = {
  enable_online_topup: false,
  enable_stripe_topup: false,
  enable_crypto_pay_topup: true,
  enable_platega_topup: true,
  pay_methods: [
    { name: 'SBP', type: PAYMENT_TYPES.PLATEGA_SBP, currency: 'RUB' },
  ],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [10],
  discount: {},
}

function renderCard(paymentType: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RechargeFormCard
        topupInfo={topupInfo}
        presetAmounts={[{ value: 10 }]}
        selectedPreset={10}
        onSelectPreset={vi.fn()}
        topupAmount={10}
        onTopupAmountChange={vi.fn()}
        paymentAmount={842.82}
        calculating={false}
        paymentType={paymentType}
        onPaymentMethodSelect={vi.fn()}
        paymentLoading={null}
        redemptionCode=''
        onRedemptionCodeChange={vi.fn()}
        onRedeem={vi.fn()}
        redeeming={false}
      />
    </I18nextProvider>
  )
}

describe('wallet payment estimate notice', () => {
  test('shows the fee notice for Platega checkout', () => {
    renderCard(PAYMENT_TYPES.PLATEGA_SBP)

    expect(
      screen.getByText(
        'The payment amount is approximate. Payment provider fees are not included.'
      )
    ).toBeVisible()
  })

  test('does not show the Platega fee notice for Crypto Bot', () => {
    renderCard(PAYMENT_TYPES.CRYPTO_PAY)

    expect(
      screen.queryByText(
        'The payment amount is approximate. Payment provider fees are not included.'
      )
    ).not.toBeInTheDocument()
  })
})
