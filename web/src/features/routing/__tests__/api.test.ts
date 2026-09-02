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
  getRoutingSources,
  resetRoutingSource,
  updateRoutingSource,
} from '../api'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

const response = { success: true, data: { families: [], sources: [] } }

describe('routing source API', () => {
  beforeEach(() => {
    apiMock.get.mockResolvedValue({ data: response })
    apiMock.put.mockResolvedValue({ data: response })
    apiMock.delete.mockResolvedValue({ data: response })
  })

  test('loads the signed-in account routing catalog', async () => {
    await expect(getRoutingSources()).resolves.toEqual(response)

    expect(apiMock.get).toHaveBeenCalledWith('/api/user/self/routing-sources', {
      skipBusinessError: true,
      skipErrorHandler: true,
    })
  })

  test('encodes the family and sends only the selected source id', async () => {
    await expect(updateRoutingSource('gpt/custom', 'premium')).resolves.toEqual(
      response
    )

    expect(apiMock.put).toHaveBeenCalledWith(
      '/api/user/self/routing-sources/gpt%2Fcustom',
      { source_id: 'premium' },
      { skipBusinessError: true, skipErrorHandler: true }
    )
  })

  test('resets the family through the dedicated delete endpoint', async () => {
    await expect(resetRoutingSource('gpt/custom')).resolves.toEqual(response)

    expect(apiMock.delete).toHaveBeenCalledWith(
      '/api/user/self/routing-sources/gpt%2Fcustom',
      { skipBusinessError: true, skipErrorHandler: true }
    )
  })
})
