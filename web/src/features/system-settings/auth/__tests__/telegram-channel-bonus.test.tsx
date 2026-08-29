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
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { OAuthSection } from '../oauth-section'

vi.mock('../../components/form-navigation-guard', () => ({
  FormNavigationGuard: () => null,
}))

describe('Telegram channel bonus settings', () => {
  test('shows the configured channel and one-time USD reward', () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <OAuthSection
          serverAddress='https://new-api.yozik.ru'
          defaultValues={{
            GitHubOAuthEnabled: false,
            GitHubClientId: '',
            GitHubClientSecret: '',
            'discord.enabled': false,
            'discord.client_id': '',
            'discord.client_secret': '',
            'oidc.enabled': false,
            'oidc.display_name': '',
            'oidc.client_id': '',
            'oidc.client_secret': '',
            'oidc.well_known': '',
            'oidc.authorization_endpoint': '',
            'oidc.token_endpoint': '',
            'oidc.user_info_endpoint': '',
            TelegramOAuthEnabled: true,
            TelegramBotToken: '',
            TelegramBotName: 'VL_API_bot',
            TelegramChannelBonusEnabled: true,
            TelegramChannelBonusChannel: '@VL_API',
            TelegramChannelBonusAmountUSD: 0.5,
            LinuxDOOAuthEnabled: false,
            LinuxDOClientId: '',
            LinuxDOClientSecret: '',
            LinuxDOMinimumTrustLevel: '0',
            WeChatAuthEnabled: false,
            WeChatServerAddress: '',
            WeChatServerToken: '',
            WeChatAccountQRCodeImageURL: '',
          }}
        />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Telegram' }))

    expect(screen.getByText('Channel subscription bonus')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Configure bonus bot' })
    ).toBeEnabled()
    expect(
      screen.getByRole('textbox', { name: 'Telegram channel' })
    ).toHaveValue('@VL_API')
    expect(
      screen.getByRole('spinbutton', { name: 'Subscription bonus (USD)' })
    ).toHaveValue(0.5)

    queryClient.clear()
  })
})
