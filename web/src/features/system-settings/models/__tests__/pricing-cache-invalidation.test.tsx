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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useSaveModelPricing } from '@/features/model-pricing/api'
import { api } from '@/lib/api'

describe('model pricing cache invalidation', () => {
  afterEach(() => vi.restoreAllMocks())

  test('invalidates every pricing consumer after saving model prices', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      data: { success: true, message: '' },
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const queryKeys = [
      ['model-pricing-config'],
      ['model-pricing-preview'],
      ['system-options'],
      ['pricing'],
      ['models'],
    ]
    for (const queryKey of queryKeys) {
      queryClient.setQueryData(queryKey, { stale: true })
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSaveModelPricing(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([
        {
          model_name: 'gpt-test',
          expected_version: 'version-1',
          pricing: { ModelRatio: 2 },
        },
      ])
    })

    await waitFor(() => {
      for (const queryKey of queryKeys) {
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
      }
    })
  })
})
