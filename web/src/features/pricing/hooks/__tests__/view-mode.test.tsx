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
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { VIEW_MODES } from '../../constants'
import { useFilters } from '../use-filters'

const useSearchMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => useSearchMock(),
}))

describe('pricing view mode', () => {
  beforeEach(() => {
    useSearchMock.mockReturnValue({})
  })

  test('uses the compact table as the default view', () => {
    const { result } = renderHook(() => useFilters([]))

    expect(result.current.viewMode).toBe(VIEW_MODES.TABLE)
  })

  test('keeps the card view when explicitly requested', () => {
    useSearchMock.mockReturnValue({ view: VIEW_MODES.CARD })

    const { result } = renderHook(() => useFilters([]))

    expect(result.current.viewMode).toBe(VIEW_MODES.CARD)
  })
})
