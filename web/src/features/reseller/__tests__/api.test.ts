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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createResellerKey,
  getResellerConfig,
  getResellerKeys,
  revealResellerKey,
} from '../api'
import type { CreateResellerKeyRequest, ResellerKey } from '../types'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

const requestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

const resellerKey: ResellerKey = {
  id: 42,
  client_label: 'North Studio',
  token_millions: 25,
  remaining_tokens: 25_000_000,
  used_tokens: 0,
  markup_percent: 80,
  term: '30-days',
  endpoint: 'https://pugshop.ru/v1',
  key: 'sk-full-key',
  created_time: 1_788_000_100,
  expired_time: 1_790_592_100,
  status: 1,
  cost: 2,
  client_price: 3.6,
}

describe('reseller API', () => {
  beforeEach(() => {
    apiMock.get.mockReset()
    apiMock.post.mockReset()
  })

  test('loads the global pricing and issued keys', async () => {
    apiMock.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            base_cost_per_million: 0.08,
            default_endpoint: 'https://pugshop.ru/v1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: [resellerKey] },
      })

    await expect(getResellerConfig()).resolves.toEqual({
      base_cost_per_million: 0.08,
      default_endpoint: 'https://pugshop.ru/v1',
    })
    await expect(getResellerKeys()).resolves.toEqual([resellerKey])
    expect(apiMock.get).toHaveBeenNthCalledWith(
      1,
      '/api/reseller/config',
      requestConfig
    )
    expect(apiMock.get).toHaveBeenNthCalledWith(
      2,
      '/api/reseller/keys',
      requestConfig
    )
  })

  test('creates a key with the server contract', async () => {
    const request: CreateResellerKeyRequest = {
      client_label: 'North Studio',
      token_millions: 25,
      markup_percent: 80,
      term: '30-days',
      request_id: 'api-test-request-1',
    }
    apiMock.post.mockResolvedValue({
      data: { success: true, data: resellerKey },
    })

    await expect(createResellerKey(request)).resolves.toEqual(resellerKey)
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/reseller/keys',
      request,
      requestConfig
    )
  })

  test('reveals a stored key and adds the public prefix once', async () => {
    apiMock.post.mockResolvedValue({
      data: { success: true, data: { key: 'stored-key' } },
    })

    await expect(revealResellerKey(42)).resolves.toBe('sk-stored-key')
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/token/42/key',
      undefined,
      requestConfig
    )

    apiMock.post.mockResolvedValue({
      data: { success: true, data: { key: 'sk-prefixed-key' } },
    })
    await expect(revealResellerKey(42)).resolves.toBe('sk-prefixed-key')
  })

  test('surfaces business errors for the page to render', async () => {
    apiMock.get.mockResolvedValue({
      data: { success: false, message: 'pricing unavailable' },
    })

    await expect(getResellerConfig()).rejects.toThrow('pricing unavailable')
  })
})
