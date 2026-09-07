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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { updateSystemOption } from '../../api'
import { useUpdateOption } from '../use-update-option'

vi.mock('../../api', () => ({
  updateSystemOption: vi.fn(),
  updateResellerCommercialSettings: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('useUpdateOption pricing cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateSystemOption).mockResolvedValue({
      success: true,
      message: '',
    })
  })

  test('invalidates cached pricing after a model ratio update succeeds', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    queryClient.setQueryData(['pricing'], { data: [{ model_name: 'stale' }] })

    function Wrapper(props: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {props.children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useUpdateOption(), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({ key: 'ModelRatio', value: '{}' })
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(['pricing'])?.isInvalidated).toBe(true)
    })
  })
})
