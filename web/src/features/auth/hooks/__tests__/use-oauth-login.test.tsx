import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SystemStatus } from '../../types'
import { useOAuthLogin } from '../use-oauth-login'

const logout = vi.fn()
const startTelegramLogin = vi.fn()
const getTelegramLoginStatus = vi.fn()
const clearAuthentication = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/api', () => ({
  applyAuthBundle: vi.fn(),
  clearAuthentication: (...args: unknown[]) => clearAuthentication(...args),
  isAuthBundle: () => false,
}))

vi.mock('../../api', () => ({
  createOAuthFlow: vi.fn(),
  logout: (...args: unknown[]) => logout(...args),
  startTelegramLogin: (...args: unknown[]) => startTelegramLogin(...args),
  getTelegramLoginStatus: (...args: unknown[]) =>
    getTelegramLoginStatus(...args),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Telegram bot login', () => {
  test('opens the bot deep link and polls the browser-bound login flow', async () => {
    logout.mockResolvedValue({ success: true })
    startTelegramLogin.mockResolvedValue({
      success: true,
      data: {
        deep_link: 'https://t.me/test_login_bot?start=login_flow-token',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      },
    })
    getTelegramLoginStatus.mockResolvedValue({
      success: true,
      data: { status: 'pending' },
    })
    const popup = {
      close: vi.fn(),
      location: { replace: vi.fn() },
      opener: window,
    }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)

    const status = {
      telegram_bot_name: '@test_login_bot',
    } as SystemStatus
    const { result, unmount } = renderHook(() => useOAuthLogin(status))

    await act(async () => {
      await result.current.handleTelegramLogin()
    })

    expect(logout).toHaveBeenCalledOnce()
    expect(clearAuthentication).toHaveBeenCalledOnce()
    expect(startTelegramLogin).toHaveBeenCalledOnce()
    expect(popup.location.replace).toHaveBeenCalledWith(
      'https://t.me/test_login_bot?start=login_flow-token'
    )
    await waitFor(() => expect(getTelegramLoginStatus).toHaveBeenCalled())
    unmount()
  })
})
