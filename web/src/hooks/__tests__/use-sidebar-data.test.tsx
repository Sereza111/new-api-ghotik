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
        expect.objectContaining({
          title: 'Referral Program',
          url: '/referral',
        }),
      ])
    )
  })
})
