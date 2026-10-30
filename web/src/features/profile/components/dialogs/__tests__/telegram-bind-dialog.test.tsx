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
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { TelegramBindDialog } from '../telegram-bind-dialog'

const startTelegramBind = vi.fn()
const getTelegramBindStatus = vi.fn()

vi.mock('@/components/dialog', () => ({
  Dialog: (props: { open: boolean; children: ReactNode }) =>
    props.open ? <div>{props.children}</div> : null,
}))

vi.mock('../../../api', () => ({
  startTelegramBind: (...args: unknown[]) => startTelegramBind(...args),
  getTelegramBindStatus: (...args: unknown[]) => getTelegramBindStatus(...args),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('Telegram binding bot flow', () => {
  test('opens the configured bot deep link without loading the phone-number widget', async () => {
    startTelegramBind.mockResolvedValue({
      success: true,
      data: {
        flow_token: 'flow-token',
        callback_url: '/legacy-callback',
        deep_link: 'https://t.me/test_login_bot?start=bind_flow-token',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    })
    getTelegramBindStatus.mockResolvedValue({
      success: true,
      data: { status: 'pending' },
    })

    render(
      <TelegramBindDialog
        open
        onOpenChange={vi.fn()}
        botName='@test_login_bot'
        onSuccess={vi.fn()}
      />
    )

    const link = await screen.findByRole('button', {
      name: 'Continue with Telegram',
    })
    expect(link).toHaveAttribute(
      'href',
      'https://t.me/test_login_bot?start=bind_flow-token'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(
      document.querySelector('script[src*="telegram-widget"]')
    ).not.toBeInTheDocument()
    await waitFor(() => expect(getTelegramBindStatus).toHaveBeenCalled())
  })
})
