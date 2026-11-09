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

import {
  calculateResellerBatchQuote,
  calculateResellerQuote,
  getResellerPortalUrl,
  normalizeResellerEndpoint,
  RESELLER_MAX_MILLIONS,
  resellerDraftSchema,
} from '../lib/pricing'

describe('reseller pricing', () => {
  test('calculates the package cost and the default 80 percent display margin', () => {
    expect(calculateResellerQuote(10, 80)).toEqual({
      cost: 1.2,
      clientPrice: 2.16,
      profit: 0.96,
    })
  })

  test('uses the configured base cost for package prices', () => {
    expect(calculateResellerQuote(50, 80, 0.08)).toEqual({
      cost: 4,
      clientPrice: 7.2,
      profit: 3.2,
    })
  })

  test('calculates total cost, client value, and profit for a batch', () => {
    expect(calculateResellerBatchQuote(10, 80, 3, 0.08)).toEqual({
      cost: 2.4,
      clientPrice: 4.32,
      profit: 1.92,
    })
  })

  test('keeps calculations inside the supported token range', () => {
    expect(calculateResellerQuote(Number.NaN, 80).cost).toBe(0.12)
    expect(calculateResellerQuote(RESELLER_MAX_MILLIONS + 1, 80).cost).toBe(120)
  })

  test('rejects client labels longer than the server limit', () => {
    const result = resellerDraftSchema.safeParse({
      clientLabel: 'a'.repeat(51),
      tokenMillions: 10,
      quantity: 1,
      markupPercent: 80,
      term: 'unlimited',
      group: 'default',
    })

    expect(result.success).toBe(false)
  })

  test('rejects quotas below one million tokens', () => {
    const result = resellerDraftSchema.safeParse({
      clientLabel: '',
      tokenMillions: 0,
      quantity: 1,
      markupPercent: 80,
      term: 'unlimited',
      group: 'default',
    })

    expect(result.success).toBe(false)
  })

  test.each([0, 101, 1.5])(
    'rejects an invalid batch size of %s',
    (quantity) => {
      const result = resellerDraftSchema.safeParse({
        clientLabel: '',
        tokenMillions: 10,
        quantity,
        markupPercent: 80,
        term: 'unlimited',
        group: 'default',
      })

      expect(result.success).toBe(false)
    }
  )

  test('normalizes reseller domains and rejects unsafe addresses', () => {
    expect(normalizeResellerEndpoint('pugshop.ru/')).toBe('https://pugshop.ru')
    expect(normalizeResellerEndpoint('http://api.pugshop.ru/v1/')).toBe(
      'http://api.pugshop.ru/v1'
    )
    expect(normalizeResellerEndpoint('javascript:alert(1)')).toBeNull()
    expect(normalizeResellerEndpoint('https://user:pass@pugshop.ru')).toBeNull()
    expect(
      normalizeResellerEndpoint('https://pugshop.ru?token=secret')
    ).toBeNull()
  })

  test('derives the reseller portal from the configured API endpoint', () => {
    expect(getResellerPortalUrl('https://reseler.errorclub.club/v1')).toBe(
      'https://reseler.errorclub.club'
    )
    expect(getResellerPortalUrl('https://example.com/custom/v1/')).toBe(
      'https://example.com/custom'
    )
    expect(getResellerPortalUrl('javascript:alert(1)')).toBeNull()
  })
})
