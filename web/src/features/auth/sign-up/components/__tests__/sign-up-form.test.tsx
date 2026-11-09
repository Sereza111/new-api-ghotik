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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { SignUpForm } from '../sign-up-form'

const mocks = vi.hoisted(() => ({
  createOAuthFlow: vi.fn(),
  handleServerError: vi.fn(),
  register: vi.fn(),
  sendCode: vi.fn(),
  setTurnstileToken: vi.fn(),
  status: {} as Record<string, unknown>,
  turnstileMount: vi.fn(),
  validateTurnstile: vi.fn(),
  wechatLoginByCode: vi.fn(),
}))

vi.mock('@/components/turnstile', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')

  return {
    Turnstile: () => {
      useEffect(() => {
        mocks.turnstileMount()
      }, [])
      return <div data-testid='turnstile' />
    },
  }
})

vi.mock('@/features/auth/api', () => ({
  createOAuthFlow: (...args: unknown[]) => mocks.createOAuthFlow(...args),
  register: (...args: unknown[]) => mocks.register(...args),
  wechatLoginByCode: (...args: unknown[]) => mocks.wechatLoginByCode(...args),
}))

vi.mock('@/features/auth/hooks/use-auth-redirect', () => ({
  useAuthRedirect: () => ({
    redirectToLogin: vi.fn(),
    handleLoginResult: vi.fn(),
  }),
}))

vi.mock('@/features/auth/hooks/use-email-verification', () => ({
  useEmailVerification: () => ({
    isSending: false,
    secondsLeft: 0,
    isActive: false,
    sendCode: (...args: unknown[]) => mocks.sendCode(...args),
  }),
}))

vi.mock('@/features/auth/hooks/use-turnstile', () => ({
  useTurnstile: () => ({
    isTurnstileEnabled: true,
    turnstileSiteKey: 'site-key',
    turnstileToken: 'turnstile-response',
    setTurnstileToken: mocks.setTurnstileToken,
    validateTurnstile: mocks.validateTurnstile,
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: mocks.status, loading: false, error: null }),
}))

vi.mock('@/lib/handle-server-error', () => ({
  handleServerError: (...args: unknown[]) => mocks.handleServerError(...args),
}))

async function submitValidRegistration() {
  const user = userEvent.setup()
  render(<SignUpForm />)

  await user.type(screen.getByLabelText('Username'), 'test-user')
  await user.type(screen.getByLabelText('Password'), 'password-123')
  await user.type(screen.getByLabelText('Confirm password'), 'password-123')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

beforeEach(() => {
  mocks.status = { oauth_register_enabled: false }
  mocks.createOAuthFlow.mockReset()
  mocks.register.mockReset()
  mocks.sendCode.mockReset()
  mocks.setTurnstileToken.mockReset()
  mocks.turnstileMount.mockReset()
  mocks.validateTurnstile.mockReset()
  mocks.validateTurnstile.mockReturnValue(true)
  mocks.wechatLoginByCode.mockReset()
})

describe('sign-up Turnstile proof lifecycle', () => {
  test('carries the proof state into a WeChat code exchange', async () => {
    mocks.status = { oauth_register_enabled: true, wechat_login: true }
    mocks.createOAuthFlow.mockResolvedValue('wechat-state')
    mocks.wechatLoginByCode.mockResolvedValue({
      success: false,
      message: 'registration rejected',
    })
    const user = userEvent.setup()
    render(<SignUpForm />)

    await user.click(
      screen.getByRole('button', { name: /Continue with WeChat/ })
    )
    await user.type(screen.getByLabelText('Verification code'), 'wechat-code')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(mocks.createOAuthFlow).toHaveBeenCalledOnce())
    expect(mocks.createOAuthFlow).toHaveBeenCalledWith(
      'wechat',
      'login',
      undefined,
      undefined,
      {
        turnstile: 'turnstile-response',
        legalConsent: true,
      }
    )
    expect(mocks.wechatLoginByCode).toHaveBeenCalledWith(
      'wechat-code',
      'wechat-state'
    )
    expect(mocks.setTurnstileToken).toHaveBeenCalledWith('')
    await waitFor(() => expect(mocks.turnstileMount).toHaveBeenCalledTimes(2))
  })

  test('rotates the proof when starting WeChat OAuth fails', async () => {
    mocks.status = { oauth_register_enabled: true, wechat_login: true }
    mocks.createOAuthFlow.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    render(<SignUpForm />)

    await user.click(
      screen.getByRole('button', { name: /Continue with WeChat/ })
    )
    await user.type(screen.getByLabelText('Verification code'), 'wechat-code')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(mocks.createOAuthFlow).toHaveBeenCalledOnce())
    expect(mocks.wechatLoginByCode).not.toHaveBeenCalled()
    expect(mocks.setTurnstileToken).toHaveBeenCalledWith('')
    await waitFor(() => expect(mocks.turnstileMount).toHaveBeenCalledTimes(2))
  })

  test.each([
    {
      label: 'an unsuccessful response',
      arrange: () =>
        mocks.register.mockResolvedValue({
          success: false,
          message: 'registration rejected',
        }),
    },
    {
      label: 'a request exception',
      arrange: () => mocks.register.mockRejectedValue(new Error('offline')),
    },
  ])('rotates the proof after $label', async ({ arrange }) => {
    arrange()

    await submitValidRegistration()

    await waitFor(() => expect(mocks.register).toHaveBeenCalledOnce())
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ turnstile: 'turnstile-response' })
    )
    expect(mocks.setTurnstileToken).toHaveBeenCalledWith('')
    await waitFor(() => expect(mocks.turnstileMount).toHaveBeenCalledTimes(2))
  })

  test.each([
    {
      label: 'returns an unsuccessful result',
      arrange: () => mocks.sendCode.mockResolvedValue(false),
    },
    {
      label: 'throws an exception',
      arrange: () => mocks.sendCode.mockRejectedValue(new Error('offline')),
    },
  ])(
    'rotates the proof when sending an email code $label',
    async ({ arrange }) => {
      mocks.status = {
        email_verification: true,
        oauth_register_enabled: false,
      }
      arrange()
      const user = userEvent.setup()
      render(<SignUpForm />)

      await user.type(
        screen.getByLabelText('Email (required for verification)'),
        'person@example.com'
      )
      await user.click(screen.getByRole('button', { name: 'Send code' }))

      await waitFor(() =>
        expect(mocks.sendCode).toHaveBeenCalledWith('person@example.com')
      )
      expect(mocks.setTurnstileToken).toHaveBeenCalledWith('')
      await waitFor(() => expect(mocks.turnstileMount).toHaveBeenCalledTimes(2))
    }
  )
})
