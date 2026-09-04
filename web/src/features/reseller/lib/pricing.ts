import { z } from 'zod'

import { RESELLER_TERMS, type ResellerQuote } from '../types'

export const RESELLER_ENDPOINT = 'https://example.com'
export const RESELLER_BASE_COST_PER_MILLION = 0.12
export const RESELLER_MIN_MILLIONS = 1
export const RESELLER_MAX_MILLIONS = 1000

export const RESELLER_PACKAGE_OPTIONS = [
  { id: 'initium', tokenMillions: 10, numeral: 'I', featured: false },
  { id: 'ascensus', tokenMillions: 50, numeral: 'II', featured: true },
  { id: 'dominium', tokenMillions: 100, numeral: 'III', featured: false },
  { id: 'imperium', tokenMillions: 500, numeral: 'IV', featured: false },
] as const

export const RESELLER_MARKUP_OPTIONS = [20, 50, 80, 100] as const

export const resellerDraftSchema = z.object({
  clientLabel: z.string().trim().max(64),
  tokenMillions: z
    .number()
    .int()
    .min(RESELLER_MIN_MILLIONS)
    .max(RESELLER_MAX_MILLIONS),
  markupPercent: z
    .number()
    .refine((value) =>
      RESELLER_MARKUP_OPTIONS.some((option) => option === value)
    ),
  term: z.enum(RESELLER_TERMS),
})

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateResellerQuote(
  tokenMillions: number,
  markupPercent: number
): ResellerQuote {
  const safeMillions = Number.isFinite(tokenMillions)
    ? Math.min(
        RESELLER_MAX_MILLIONS,
        Math.max(RESELLER_MIN_MILLIONS, Math.trunc(tokenMillions))
      )
    : RESELLER_MIN_MILLIONS
  const safeMarkup = Number.isFinite(markupPercent)
    ? Math.max(0, markupPercent)
    : 0
  const cost = roundCurrency(safeMillions * RESELLER_BASE_COST_PER_MILLION)
  const clientPrice = roundCurrency(cost * (1 + safeMarkup / 100))

  return {
    cost,
    clientPrice,
    profit: roundCurrency(clientPrice - cost),
  }
}
