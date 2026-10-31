import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SystemStatus } from '../../types'
import { useOAuthLogin } from '../use-oauth-login'

const logout = vi.fn()
const createOAuthAuthorization = vi.fn()
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
  clearAuthentication: (...args: unknown[]) => clearAuthentication(...args),
}))

vi.mock('../../api', () => ({
  createOAuthFlow: vi.fn(),
  createOAuthAuthorization: (...args: unknown[]) =>
    createOAuthAuthorization(...args),
  logout: (...args: unknown[]) => logout(...args),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Telegram bot login', () => {
  test('opens the unified OAuth authorization URL', async () => {
    logout.mockResolvedValue({ success: true })
    createOAuthAuthorization.mockResolvedValue({
      authorizationUrl: 'https://t.me/test_login_bot?start=login_flow-token',
      state: 'telegram-state',
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    const status = {
      telegram_oauth_configured: true,
    } as SystemStatus
    const { result } = renderHook(() => useOAuthLogin(status))

    await act(async () => {
      await result.current.handleTelegramLogin()
    })

    expect(logout).toHaveBeenCalledOnce()
    expect(clearAuthentication).toHaveBeenCalledOnce()
    expect(createOAuthAuthorization).toHaveBeenCalledWith('telegram', 'login')
    expect(open).toHaveBeenCalledWith(
      'https://t.me/test_login_bot?start=login_flow-token',
      '_self'
    )
  })
})
