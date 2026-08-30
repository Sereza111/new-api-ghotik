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
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { applyAuthBundle, clearAuthentication, isAuthBundle } from '@/lib/api'

import {
  createOAuthFlow,
  getTelegramLoginStatus,
  logout,
  startTelegramLogin,
} from '../api'
import { sanitizeAuthRedirect } from '../lib/auth-redirect'
import {
  buildGitHubOAuthUrl,
  buildDiscordOAuthUrl,
  buildOIDCOAuthUrl,
  buildLinuxDOOAuthUrl,
} from '../lib/oauth'
import type { SystemStatus, CustomOAuthProviderInfo } from '../types'

/**
 * Hook for managing OAuth login
 */
export function useOAuthLogin(
  status: SystemStatus | null,
  redirectTo?: string
) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [githubButtonText, setGithubButtonText] = useState('')
  const [githubButtonDisabled, setGithubButtonDisabled] = useState(false)
  const [telegramFlowExpiresAt, setTelegramFlowExpiresAt] = useState<
    number | null
  >(null)
  const githubTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setGithubButtonText(t('Continue with GitHub'))

    return () => {
      if (githubTimeoutRef.current) {
        clearTimeout(githubTimeoutRef.current)
      }
    }
  }, [t])

  useEffect(() => {
    if (!telegramFlowExpiresAt) return

    const abortController = new AbortController()
    let requestPending = false
    let stopped = false
    const stopPolling = (message?: string) => {
      if (stopped) return
      stopped = true
      setTelegramFlowExpiresAt(null)
      setIsLoading(false)
      if (message) toast.error(message)
    }
    const poll = async () => {
      if (requestPending || stopped) return
      if (Date.now() >= telegramFlowExpiresAt * 1000) {
        stopPolling(t('Telegram binding failed. Please try again.'))
        return
      }
      requestPending = true
      try {
        const response = await getTelegramLoginStatus(abortController.signal)
        if (stopped) return
        if (response.success && isAuthBundle(response.data)) {
          stopped = true
          applyAuthBundle(response.data)
          toast.success(t('Signed in successfully!'))
          const target =
            sanitizeAuthRedirect(redirectTo, window.location.origin) ??
            '/dashboard'
          window.location.assign(target)
          return
        }
        const status = (response.data as { status?: string } | undefined)
          ?.status
        if (!response.success || status !== 'pending') {
          stopPolling(
            response.message ||
              t('Failed to start {{provider}} login', {
                provider: 'Telegram',
              })
          )
        }
      } catch {
        if (!abortController.signal.aborted) {
          stopPolling(
            t('Failed to start {{provider}} login', {
              provider: 'Telegram',
            })
          )
        }
      } finally {
        requestPending = false
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), 1500)
    return () => {
      stopped = true
      abortController.abort()
      window.clearInterval(interval)
    }
  }, [redirectTo, t, telegramFlowExpiresAt])

  const resetSession = async () => {
    const response = await logout()
    if (!response.success) {
      throw new Error(response.message || t('Failed to sign out session'))
    }
    clearAuthentication()
  }

  const handleGitHubLogin = async () => {
    if (!status?.github_client_id) return
    if (githubButtonDisabled) return

    setIsLoading(true)
    setGithubButtonDisabled(true)
    setGithubButtonText(t('Redirecting to GitHub...'))

    if (githubTimeoutRef.current) {
      clearTimeout(githubTimeoutRef.current)
    }

    githubTimeoutRef.current = setTimeout(() => {
      setIsLoading(false)
      setGithubButtonText(
        t('Request timed out, please refresh and restart GitHub login')
      )
      setGithubButtonDisabled(true)
    }, 20000)

    try {
      await resetSession()
      const state = await createOAuthFlow('github', 'login')

      const url = buildGitHubOAuthUrl(status.github_client_id, state)
      window.location.assign(url)
    } catch {
      toast.error(t('Failed to start GitHub login'))
      if (githubTimeoutRef.current) {
        clearTimeout(githubTimeoutRef.current)
      }
      setIsLoading(false)
      setGithubButtonText(t('Continue with GitHub'))
      setGithubButtonDisabled(false)
    }
  }

  const handleDiscordLogin = async () => {
    if (!status?.discord_client_id) return

    setIsLoading(true)
    try {
      await resetSession()
      const state = await createOAuthFlow('discord', 'login')

      const url = buildDiscordOAuthUrl(status.discord_client_id, state)
      window.open(url, '_self')
    } catch {
      toast.error(t('Failed to start Discord login'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleOIDCLogin = async () => {
    if (!status?.oidc_authorization_endpoint || !status?.oidc_client_id) return

    setIsLoading(true)
    try {
      await resetSession()
      const state = await createOAuthFlow('oidc', 'login')

      const url = buildOIDCOAuthUrl(
        status.oidc_authorization_endpoint,
        status.oidc_client_id,
        state
      )
      window.open(url, '_self')
    } catch {
      toast.error(t('Failed to start OIDC login'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleLinuxDOLogin = async () => {
    if (!status?.linuxdo_client_id) return

    setIsLoading(true)
    try {
      await resetSession()
      const state = await createOAuthFlow('linuxdo', 'login')

      const url = buildLinuxDOOAuthUrl(status.linuxdo_client_id, state)
      window.open(url, '_self')
    } catch {
      toast.error(t('Failed to start LinuxDO login'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleTelegramLogin = async () => {
    const botName = status?.telegram_bot_name?.trim()
    if (!botName) {
      toast.error(t('Login failed'))
      return
    }

    const telegramWindow = window.open('', '_blank')
    if (!telegramWindow) {
      toast.error(
        t('Failed to start {{provider}} login', { provider: 'Telegram' })
      )
      return
    }
    setIsLoading(true)
    try {
      await resetSession()
      const response = await startTelegramLogin()
      if (!response.success || !response.data?.deep_link) {
        throw new Error(response.message || 'Telegram login failed')
      }
      telegramWindow.opener = null
      telegramWindow.location.replace(response.data.deep_link)
      setTelegramFlowExpiresAt(response.data.expires_at)
    } catch {
      telegramWindow.close()
      toast.error(
        t('Failed to start {{provider}} login', { provider: 'Telegram' })
      )
      setIsLoading(false)
    }
  }

  const handleCustomOAuthLogin = async (provider: CustomOAuthProviderInfo) => {
    if (!provider.authorization_endpoint || !provider.client_id) return

    setIsLoading(true)
    try {
      await resetSession()
      const state = await createOAuthFlow(provider.slug, 'login')

      const redirectUri = `${window.location.origin}/oauth/${provider.slug}`
      const url = new URL(provider.authorization_endpoint)
      url.searchParams.set('client_id', provider.client_id)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('state', state)
      if (provider.scopes) {
        url.searchParams.set('scope', provider.scopes)
      }

      window.open(url.toString(), '_self')
    } catch {
      toast.error(
        t('Failed to start {{provider}} login', { provider: provider.name })
      )
    } finally {
      setIsLoading(false)
    }
  }

  return {
    isLoading,
    githubButtonText,
    githubButtonDisabled,
    handleGitHubLogin,
    handleDiscordLogin,
    handleOIDCLogin,
    handleLinuxDOLogin,
    handleTelegramLogin,
    handleCustomOAuthLogin,
  }
}
