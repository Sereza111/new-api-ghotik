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
import type { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'

import { parseQuotaFromDollars } from '@/lib/format'

import { apiKeySchema } from '../../types'
import {
  MAX_TOKEN_QUOTA_MILLIONS,
  formatApiKeyQuota,
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from '../index'

const t = ((key: string) => key) as TFunction

const apiKeyFixture = apiKeySchema.parse({
  id: 1,
  name: 'limited key',
  key: 'masked',
  status: 1,
  remain_quota: 2_500_000,
  used_quota: 500_000,
  quota_mode: 'tokens',
  unlimited_quota: false,
  expired_time: -1,
  created_time: 1,
  accessed_time: 0,
  group: 'default',
  auto_groups: null,
  cross_group_retry: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
})

describe('API key quota mode mapping', () => {
  test('defaults legacy API keys and new forms to money mode', () => {
    const legacyApiKey = { ...apiKeyFixture } as Record<string, unknown>
    delete legacyApiKey.quota_mode

    expect(apiKeySchema.parse(legacyApiKey).quota_mode).toBe('money')
    expect(getApiKeyFormDefaultValues(false).quota_mode).toBe('money')
  })

  test('serializes token-mode millions as raw token quota', () => {
    const values = {
      ...getApiKeyFormDefaultValues(false),
      name: 'one and a quarter million',
      unlimited_quota: false,
      quota_mode: 'tokens' as const,
      remain_quota_amount: 1.25,
    }

    const payload = transformFormDataToPayload(values)

    expect(payload.quota_mode).toBe('tokens')
    expect(payload.remain_quota).toBe(1_250_000)
  })

  test('keeps existing currency conversion in money mode', () => {
    const values = {
      ...getApiKeyFormDefaultValues(false),
      name: 'money quota',
      unlimited_quota: false,
      remain_quota_amount: 2,
    }

    const payload = transformFormDataToPayload(values)

    expect(payload.quota_mode).toBe('money')
    expect(payload.remain_quota).toBe(parseQuotaFromDollars(2))
  })

  test('deserializes raw token quota into millions for editing', () => {
    const values = transformApiKeyToFormDefaults(apiKeyFixture)

    expect(values.quota_mode).toBe('tokens')
    expect(values.remain_quota_amount).toBe(2.5)
  })

  test('rejects a negative token quota', () => {
    const result = getApiKeyFormSchema(t).safeParse({
      ...getApiKeyFormDefaultValues(false),
      name: 'invalid token quota',
      unlimited_quota: false,
      quota_mode: 'tokens',
      remain_quota_amount: -1,
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['remain_quota_amount'])
  })

  test('rejects a non-finite quota amount', () => {
    const result = getApiKeyFormSchema(t).safeParse({
      ...getApiKeyFormDefaultValues(false),
      name: 'invalid quota',
      unlimited_quota: false,
      remain_quota_amount: Number.NaN,
    })

    expect(result.success).toBe(false)
  })

  test('rejects a token quota above the backend int32 limit', () => {
    const result = getApiKeyFormSchema(t).safeParse({
      ...getApiKeyFormDefaultValues(false),
      name: 'too large',
      unlimited_quota: false,
      quota_mode: 'tokens',
      remain_quota_amount: MAX_TOKEN_QUOTA_MILLIONS + 0.000001,
    })

    expect(result.success).toBe(false)
  })

  test('formats token-mode quota in millions instead of currency', () => {
    expect(formatApiKeyQuota(2_500_000, 'tokens', 'Tokens', 'en')).toBe(
      '2.5M Tokens'
    )
  })
})
