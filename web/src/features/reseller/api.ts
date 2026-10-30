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
import axios from 'axios'

import { api } from '@/lib/api'

import { normalizeResellerEndpoint } from './lib/pricing'
import type {
  CreateResellerKeyRequest,
  PurchaseResellerSubscriptionRequest,
  ResellerApiResponse,
  ResellerConfig,
  ResellerKey,
  ResellerQuotaAdjustmentRequest,
  ResellerSubscription,
} from './types'

const REQUEST_CONFIG = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

function getResellerServerErrorMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const payload: unknown = error.response?.data
  if (!payload || typeof payload !== 'object') return null

  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim()
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim()
  }
  if (record.error && typeof record.error === 'object') {
    const nestedMessage = (record.error as Record<string, unknown>).message
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim()
    }
  }
  return null
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
    !normalizeResellerEndpoint(config.default_endpoint) ||
    !Array.isArray(config.available_groups) ||
    config.available_groups.some(
      (group) =>
        !group ||
        typeof group.name !== 'string' ||
        !group.name.trim() ||
        typeof group.description !== 'string' ||
        (typeof group.ratio !== 'number' && typeof group.ratio !== 'string')
    ) ||
    !isValidResellerSubscription(config.subscription)
  ) {
    throw new Error(response.data.message || 'Failed to load reseller pricing')
  }

  return config
}

function isValidResellerSubscription(
  subscription: ResellerSubscription | undefined
): subscription is ResellerSubscription {
  return Boolean(
    subscription &&
    typeof subscription.active === 'boolean' &&
    Number.isFinite(subscription.expires_at) &&
    subscription.expires_at >= 0 &&
    Number.isFinite(subscription.list_price) &&
    subscription.list_price >= 0.01 &&
    Number.isInteger(subscription.discount_percent) &&
    subscription.discount_percent >= 0 &&
    subscription.discount_percent <= 90 &&
    Number.isFinite(subscription.price) &&
    subscription.price >= 0.01 &&
    Number.isInteger(subscription.duration_days) &&
    subscription.duration_days >= 1 &&
    subscription.duration_days <= 3650
  )
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

export async function deleteResellerKey(id: number): Promise<void> {
  const response = await api.delete<ResellerApiResponse<null>>(
    `/api/reseller/keys/${id}`,
    REQUEST_CONFIG
  )

  if (!response.data.success) {
    throw new Error(response.data.message || 'Failed to delete reseller key')
  }
}

export async function reissueResellerKey(id: number): Promise<ResellerKey> {
  const response = await api.post<ResellerApiResponse<ResellerKey>>(
    `/api/reseller/keys/${id}/reissue`,
    undefined,
    REQUEST_CONFIG
  )

  if (!response.data.success || !response.data.data?.key) {
    throw new Error(response.data.message || 'Failed to reissue reseller key')
  }

  return response.data.data
}

export async function adjustResellerKeyQuota(
  id: number,
  request: ResellerQuotaAdjustmentRequest
): Promise<ResellerKey> {
  try {
    const response = await api.post<ResellerApiResponse<ResellerKey>>(
      `/api/reseller/keys/${id}/quota`,
      request,
      REQUEST_CONFIG
    )

    if (!response.data.success || !response.data.data) {
      throw new Error(
        response.data.message || 'Failed to adjust reseller quota'
      )
    }

    return response.data.data
  } catch (error) {
    const serverMessage = getResellerServerErrorMessage(error)
    if (serverMessage) throw new Error(serverMessage)
    throw error
  }
}

export async function purchaseResellerSubscription(
  request: PurchaseResellerSubscriptionRequest
): Promise<ResellerSubscription> {
  const response = await api.post<ResellerApiResponse<ResellerSubscription>>(
    '/api/reseller/subscription',
    request,
    REQUEST_CONFIG
  )
  const subscription = response.data.data

  if (
    !response.data.success ||
    !isValidResellerSubscription(subscription) ||
    !subscription.active
  ) {
    throw new Error(
      response.data.message || 'Failed to purchase reseller subscription'
    )
  }

  return subscription
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
