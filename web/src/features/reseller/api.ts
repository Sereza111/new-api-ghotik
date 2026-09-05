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
import { api } from '@/lib/api'

import { normalizeResellerEndpoint } from './lib/pricing'
import type {
  CreateResellerKeyRequest,
  ResellerApiResponse,
  ResellerConfig,
  ResellerKey,
} from './types'

const REQUEST_CONFIG = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

export async function getResellerConfig(): Promise<ResellerConfig> {
  const response = await api.get<ResellerApiResponse<ResellerConfig>>(
    '/api/reseller/config',
    REQUEST_CONFIG
  )

  const config = response.data.data
  if (
    !response.data.success ||
    !config ||
    !Number.isFinite(config.base_cost_per_million) ||
    config.base_cost_per_million <= 0 ||
    !normalizeResellerEndpoint(config.default_endpoint)
  ) {
    throw new Error(response.data.message || 'Failed to load reseller pricing')
  }

  return config
}

export async function getResellerKeys(): Promise<ResellerKey[]> {
  const response = await api.get<ResellerApiResponse<ResellerKey[]>>(
    '/api/reseller/keys',
    REQUEST_CONFIG
  )

  if (!response.data.success || !Array.isArray(response.data.data)) {
    throw new Error(response.data.message || 'Failed to load reseller keys')
  }

  return response.data.data
}

export async function createResellerKey(
  request: CreateResellerKeyRequest
): Promise<ResellerKey> {
  const response = await api.post<ResellerApiResponse<ResellerKey>>(
    '/api/reseller/keys',
    request,
    REQUEST_CONFIG
  )

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.message || 'Failed to issue reseller key')
  }

  return response.data.data
}

export async function revealResellerKey(id: number): Promise<string> {
  const response = await api.post<ResellerApiResponse<{ key: string }>>(
    `/api/token/${id}/key`,
    undefined,
    REQUEST_CONFIG
  )
  const key = response.data.data?.key

  if (!response.data.success || !key) {
    throw new Error(response.data.message || 'Failed to reveal key')
  }

  return key.startsWith('sk-') ? key : `sk-${key}`
}
