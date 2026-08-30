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
import { Loader2, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getServerErrorMessageKey } from '@/lib/server-error-message'

import { getTelegramBindStatus, startTelegramBind } from '../../api'

// ============================================================================
// Telegram Bind Dialog Component
// ============================================================================

interface TelegramBindDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  botName: string
  onSuccess: () => void
}

export function TelegramBindDialog({
  open,
  onOpenChange,
  botName,
  onSuccess,
}: TelegramBindDialogProps) {
  const { t } = useTranslation()
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const [flowToken, setFlowToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createBindFlow = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDeepLink(null)
    setFlowToken(null)
    setExpiresAt(null)
    try {
      const response = await startTelegramBind()
      if (!response.success || !response.data?.deep_link) {
        throw new Error(
          response.message || t('Failed to start Telegram binding')
        )
      }
      setFlowToken(response.data.flow_token)
      setDeepLink(response.data.deep_link)
      setExpiresAt(response.data.expires_at)
    } catch (bindError: unknown) {
      setError(
        bindError instanceof Error
          ? bindError.message
          : t('Failed to start Telegram binding')
      )
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!open) {
      setDeepLink(null)
      setFlowToken(null)
      setExpiresAt(null)
      setError(null)
      return
    }
    void createBindFlow()
  }, [createBindFlow, open])

  useEffect(() => {
    if (!open || !flowToken || !expiresAt) return

    const abortController = new AbortController()
    let requestPending = false
    let stopped = false
    const poll = async () => {
      if (requestPending || stopped) return
      if (Date.now() >= expiresAt * 1000) {
        stopped = true
        setError(
          t(
            'This Telegram binding request has expired or has already been used.'
          )
        )
        return
      }
      requestPending = true
      try {
        const response = await getTelegramBindStatus(
          flowToken,
          abortController.signal
        )
        if (stopped) return
        if (response.success && response.data?.status === 'complete') {
          stopped = true
          toast.success(t('Binding successful!'))
          onSuccess()
          onOpenChange(false)
          return
        }
        if (!response.success) {
          const code = (response as { code?: string }).code
          const messageKey = getServerErrorMessageKey({ code })
          stopped = true
          setError(
            t(messageKey || 'Telegram binding failed. Please try again.')
          )
        }
      } catch {
        if (!abortController.signal.aborted) {
          stopped = true
          setError(t('Telegram binding failed. Please try again.'))
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
  }, [expiresAt, flowToken, onOpenChange, onSuccess, open, t])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Bind Telegram Account')}
      description={t('Click the button below to bind your Telegram account')}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-4 py-4'>
        <Alert>
          <Send className='h-4 w-4' />
          <AlertDescription>
            {t(
              'You will be redirected to Telegram to complete the binding process.'
            )}
          </AlertDescription>
        </Alert>

        <div className='flex flex-col items-center justify-center gap-4 rounded-lg border p-6'>
          <div className='flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900'>
            <Send className='h-6 w-6 text-blue-600 dark:text-blue-400' />
          </div>

          <div className='text-center'>
            <p className='text-muted-foreground text-sm'>
              {t('Bot:')}{' '}
              <span className='font-mono font-semibold'>
                @{botName.replace(/^@/, '')}
              </span>
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t(
                "After clicking the button, you'll be asked to authorize the bot"
              )}
            </p>
          </div>

          {loading && <Skeleton className='h-10 w-52' />}
          {error && (
            <div className='flex flex-col items-center gap-3 text-center'>
              <p className='text-destructive text-sm'>{error}</p>
              <Button type='button' variant='outline' onClick={createBindFlow}>
                {t('Retry')}
              </Button>
            </div>
          )}
          {deepLink && !error && (
            <Button
              render={
                <a href={deepLink} target='_blank' rel='noopener noreferrer' />
              }
            >
              <Send aria-hidden='true' />
              {t('Continue with Telegram')}
            </Button>
          )}
          {deepLink && !error && (
            <p className='text-muted-foreground flex items-center gap-2 text-xs'>
              <Loader2
                className='h-3.5 w-3.5 animate-spin'
                aria-hidden='true'
              />
              {t('Waiting')}
            </p>
          )}
        </div>

        <p className='text-muted-foreground text-center text-xs'>
          {t('The binding will complete automatically after authorization')}
        </p>
      </div>
    </Dialog>
  )
}
