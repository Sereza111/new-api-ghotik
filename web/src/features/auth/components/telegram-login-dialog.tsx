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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Spinner } from '@/components/ui/spinner'

type TelegramLoginDialogProps = {
  open: boolean
  botName: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onAuthorization: (authorization: unknown) => void
}

export function TelegramLoginDialog(props: TelegramLoginDialogProps) {
  const { t } = useTranslation()
  const widgetFrame = useRef<HTMLIFrameElement | null>(null)
  const authorizationHandler = useRef(props.onAuthorization)
  const [widgetState, setWidgetState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading')
  const botName = props.botName.trim().replace(/^@/, '')
  const widgetUrl =
    props.open && botName
      ? `https://oauth.telegram.org/embed/${encodeURIComponent(botName)}?origin=${encodeURIComponent(window.location.origin)}&return_to=${encodeURIComponent(window.location.href)}&size=large&radius=8&request_access=write`
      : ''

  useEffect(() => {
    authorizationHandler.current = props.onAuthorization
  }, [props.onAuthorization])

  useEffect(() => {
    if (!widgetUrl) return
    setWidgetState('loading')

    const handleTelegramMessage = (event: MessageEvent<unknown>) => {
      if (
        !['https://oauth.telegram.org', 'null'].includes(event.origin) ||
        event.source !== widgetFrame.current?.contentWindow
      ) {
        return
      }

      let data: { event?: string; auth_data?: unknown } | null = null
      try {
        data = (
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        ) as { event?: string; auth_data?: unknown } | null
      } catch {
        return
      }
      if (data?.event === 'auth_user' && data.auth_data) {
        authorizationHandler.current(data.auth_data)
      }
    }

    window.addEventListener('message', handleTelegramMessage)
    return () => window.removeEventListener('message', handleTelegramMessage)
  }, [widgetUrl])

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Telegram Login Widget')}
      description={t('Continue with Telegram')}
      contentClassName='max-w-sm'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div
        className='flex min-h-12 items-center justify-center'
        aria-busy={props.pending || widgetState === 'loading'}
      >
        {widgetState === 'loading' && <Spinner />}
        {widgetState === 'failed' && (
          <p className='text-destructive text-sm'>{t('Login failed')}</p>
        )}
        {widgetUrl && (
          <iframe
            ref={widgetFrame}
            src={widgetUrl}
            title={t('Telegram Login Widget')}
            className={widgetState === 'ready' ? 'h-10 w-[238px]' : 'hidden'}
            scrolling='no'
            sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts'
            onLoad={() => setWidgetState('ready')}
            onError={() => setWidgetState('failed')}
          />
        )}
      </div>
    </Dialog>
  )
}
