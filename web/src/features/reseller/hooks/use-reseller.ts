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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createResellerKey,
  getResellerConfig,
  getResellerKeys,
  revealResellerKey,
} from '../api'
import type { CreateResellerKeyRequest, ResellerKey } from '../types'

export const resellerQueryKeys = {
  config: ['reseller', 'config'] as const,
  keys: ['reseller', 'keys'] as const,
}

export function useResellerConfig() {
  return useQuery({
    queryKey: resellerQueryKeys.config,
    queryFn: getResellerConfig,
    staleTime: 5 * 60 * 1000,
  })
}

export function useResellerKeys() {
  return useQuery({
    queryKey: resellerQueryKeys.keys,
    queryFn: getResellerKeys,
    staleTime: 30 * 1000,
  })
}

export function useCreateResellerKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateResellerKeyRequest) =>
      createResellerKey(request),
    onSuccess: (createdKey) => {
      queryClient.setQueryData<ResellerKey[]>(
        resellerQueryKeys.keys,
        (currentKeys) => [
          createdKey,
          ...(currentKeys ?? []).filter((item) => item.id !== createdKey.id),
        ]
      )
    },
  })
}

export function useRevealResellerKey() {
  return useMutation({
    mutationFn: (id: number) => revealResellerKey(id),
  })
}
