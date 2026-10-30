/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { describe, expect, it } from 'vitest'

import {
  formatPaymentAmount,
  formatRubAmount,
  formatTopupPaymentAmount,
  formatUsdAmount,
} from './format'

describe('formatUsdAmount', () => {
  it('marks Crypto Pay amounts as USD', () => {
    expect(formatUsdAmount(10)).toBe('$10')
    expect(formatUsdAmount('0.25')).toMatch(/^\$0[,.]25$/)
  })
})

describe('payment currency formatting', () => {
  it('marks Platega checkout amounts as RUB', () => {
    expect(formatPaymentAmount(80, 'platega_sbp')).toBe(formatRubAmount(80))
  })

  it('uses the provider currency in top-up history', () => {
    expect(formatTopupPaymentAmount(80, 'platega')).toBe(formatRubAmount(80))
    expect(formatTopupPaymentAmount(10, 'crypto_pay')).toBe(formatUsdAmount(10))
  })
})
