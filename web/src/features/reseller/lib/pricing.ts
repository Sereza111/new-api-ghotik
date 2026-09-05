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
import { z } from 'zod'

import { RESELLER_TERMS, type ResellerQuote } from '../types'

export const DEFAULT_RESELLER_ENDPOINT = 'https://pugshop.ru/v1'
export const RESELLER_BASE_COST_PER_MILLION = 0.12
export const RESELLER_MIN_MILLIONS = 1
export const RESELLER_MAX_MILLIONS = 1000

export const RESELLER_PACKAGE_OPTIONS = [
  {
    id: 'initium',
    tokenMillions: 10,
    numeral: 'I',
    scene: 'avaritia',
    featured: false,
  },
  {
    id: 'ascensus',
    tokenMillions: 50,
    numeral: 'II',
    scene: 'invidia',
    featured: true,
  },
  {
    id: 'dominium',
    tokenMillions: 100,
    numeral: 'III',
    scene: 'superbia',
    featured: false,
  },
  {
    id: 'imperium',
    tokenMillions: 500,
    numeral: 'IV',
    scene: 'luxuria',
    featured: false,
  },
] as const

export const RESELLER_MARKUP_OPTIONS = [20, 50, 80, 100] as const

export const resellerDraftSchema = z.object({
  clientLabel: z.string().trim().max(50),
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

export function normalizeResellerEndpoint(value: string): string | null {
  const input = value.trim()
  const hasControlCharacter = [...input].some(
    (character) => character.charCodeAt(0) <= 0x20
  )
  if (!input || input.includes('\\') || hasControlCharacter) return null

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input)
    ? input
    : `https://${input}`

  try {
    const parsed = new URL(candidate)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname
    ) {
      return null
    }

    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateResellerQuote(
  tokenMillions: number,
  markupPercent: number,
  baseCostPerMillion = RESELLER_BASE_COST_PER_MILLION
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
  const safeBaseCost =
    Number.isFinite(baseCostPerMillion) && baseCostPerMillion > 0
      ? baseCostPerMillion
      : RESELLER_BASE_COST_PER_MILLION
  const cost = roundCurrency(safeMillions * safeBaseCost)
  const clientPrice = roundCurrency(cost * (1 + safeMarkup / 100))

  return {
    cost,
    clientPrice,
    profit: roundCurrency(clientPrice - cost),
  }
}
