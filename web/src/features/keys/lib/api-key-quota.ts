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
import { formatQuota } from '@/lib/format'

import type { ApiKeyQuotaMode } from '../types'

export const TOKENS_PER_MILLION = 1_000_000
export const MAX_TOKEN_QUOTA_UNITS = 2_147_483_647
export const MAX_TOKEN_QUOTA_MILLIONS =
  MAX_TOKEN_QUOTA_UNITS / TOKENS_PER_MILLION

export function quotaMillionsToUnits(millions: number): number {
  if (!Number.isFinite(millions) || millions < 0) return 0
  const units = Math.round(millions * TOKENS_PER_MILLION)
  if (!Number.isSafeInteger(units)) return 0
  return Math.min(units, MAX_TOKEN_QUOTA_UNITS)
}

export function quotaUnitsToMillions(units: number): number {
  if (!Number.isFinite(units)) return 0
  return units / TOKENS_PER_MILLION
}

export function formatApiKeyQuota(
  quota: number,
  mode: ApiKeyQuotaMode | undefined,
  tokensLabel: string,
  locale?: Intl.LocalesArgument,
  includeUnit = true
): string {
  if (mode !== 'tokens') return formatQuota(quota)

  const millions = quotaUnitsToMillions(quota)
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6,
  }).format(millions)
  return includeUnit ? `${formatted}M ${tokensLabel}` : formatted
}
