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

import type { RoutingSourcesApiResponse } from './types'

const routingSourcesPath = '/api/user/self/routing-sources'
export const routingSourcesQueryKey = ['routing', 'sources'] as const

export async function getRoutingSources(): Promise<RoutingSourcesApiResponse> {
  const response = await api.get<RoutingSourcesApiResponse>(
    routingSourcesPath,
    {
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return response.data
}

export async function updateRoutingSource(
  familyId: string,
  sourceId: string
): Promise<RoutingSourcesApiResponse> {
  const response = await api.put<RoutingSourcesApiResponse>(
    `${routingSourcesPath}/${encodeURIComponent(familyId)}`,
    { source_id: sourceId },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}

export async function resetRoutingSource(
  familyId: string
): Promise<RoutingSourcesApiResponse> {
  const response = await api.delete<RoutingSourcesApiResponse>(
    `${routingSourcesPath}/${encodeURIComponent(familyId)}`,
    { skipBusinessError: true, skipErrorHandler: true }
  )
  return response.data
}
