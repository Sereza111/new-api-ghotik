import { describe, expect, test } from 'vitest'

import {
  calculateResellerQuote,
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

  test('keeps preview calculations inside the supported token range', () => {
    expect(calculateResellerQuote(Number.NaN, 80).cost).toBe(0.12)
    expect(calculateResellerQuote(RESELLER_MAX_MILLIONS + 1, 80).cost).toBe(120)
  })

  test('rejects quotas below one million tokens', () => {
    const result = resellerDraftSchema.safeParse({
      clientLabel: '',
      tokenMillions: 0,
      markupPercent: 80,
      term: 'unlimited',
    })

    expect(result.success).toBe(false)
  })
})
