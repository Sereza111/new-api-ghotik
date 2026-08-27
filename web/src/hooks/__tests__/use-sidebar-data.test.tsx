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
import { describe, expect, test, vi } from 'vitest'

import { useSidebarData } from '../use-sidebar-data'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('useSidebarData', () => {
  test('shows the AI chat but omits external chat presets', () => {
    const { result } = renderHook(() => useSidebarData())
    const chatGroup = result.current.navGroups.find(
      (group) => group.id === 'chat'
    )

    expect(chatGroup?.items).toHaveLength(1)
    expect(chatGroup?.items[0]).toMatchObject({
      title: 'Chat with AI',
      url: '/playground',
    })
    expect(
      chatGroup?.items.some(
        (item) => 'type' in item && item.type === 'chat-presets'
      )
    ).toBe(false)
  })

  test('shows routing in the personal navigation group', () => {
    const { result } = renderHook(() => useSidebarData())
    const personalGroup = result.current.navGroups.find(
      (group) => group.id === 'personal'
    )

    expect(personalGroup?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Routing', url: '/routing' }),
      ])
    )
  })
})
