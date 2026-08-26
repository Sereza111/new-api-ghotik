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
import { describe, expect, test } from 'vitest'

import { PAYMENT_TYPES } from '../../constants'
import { requestPaymentAmount } from '../use-payment'

describe('Platega payment amount routing', () => {
  test.each([
    PAYMENT_TYPES.PLATEGA_SBP,
    PAYMENT_TYPES.PLATEGA_CARD,
    PAYMENT_TYPES.PLATEGA_CRYPTO,
  ])('uses the RUB calculator for %s', async (paymentType) => {
    const calls: string[] = []
    const amount = await requestPaymentAmount(10, paymentType, {
      regular: async () => ({ success: true, data: '1' }),
      stripe: async () => ({ success: true, data: '2' }),
      cryptoPay: async () => ({ success: true, data: '3' }),
      platega: async (request) => {
        calls.push(`platega:${request.amount}`)
        return { success: true, data: '800.00' }
      },
      waffo: async () => ({ success: true, data: '4' }),
      waffoPancake: async () => ({ success: true, data: '5' }),
    })

    expect(amount).toBe(800)
    expect(calls).toEqual(['platega:10'])
  })
})
