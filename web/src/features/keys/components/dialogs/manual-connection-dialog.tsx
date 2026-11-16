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
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Globe,
  KeyRound,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getCodexSetup, type CodexPlatform } from '@/features/docs/codex-setup'
import { useConnectionTour } from '@/features/onboarding/store'
import { useStatus } from '@/hooks/use-status'
import { getUserModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import type { ApiKey } from '../../types'

type Client = 'openai' | 'codex' | 'claude'
type Props = {
  onOpenChange: (open: boolean) => void
  tokenKey: string
  apiKey: ApiKey
}

export function ManualConnectionDialog(props: Props) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [client, setClient] = useState<Client>('openai')
  const [platform, setPlatform] = useState<CodexPlatform>('windows')
  const [model, setModel] = useState('')
  const phase = useConnectionTour((state) => state.phase)
  const tourUserId = useConnectionTour((state) => state.userId)
  const tourActive = phase.startsWith('manual-') || phase === 'verify'
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['user-models-manual-connection'],
    queryFn: async () => requireServerSuccess(await getUserModels()),
    staleTime: 5 * 60 * 1000,
  })
  const allowed = props.apiKey.model_limits_enabled
    ? new Set(
        (props.apiKey.model_limits || '')
          .split(',')
          .map((value) => value.trim())
      )
    : null
  const options = (data?.data ?? [])
    .filter((value) => !allowed || allowed.has(value))
    .map((value) => ({ label: value, value }))
  const modelAvailable = options.some((option) => option.value === model)
  const configuredAddress =
    typeof status?.server_address === 'string'
      ? status.server_address.trim()
      : ''
  const origin = (configuredAddress || window.location.origin).replace(
    /\/+$/,
    ''
  )
  const rootUrl = origin.replace(/\/v1$/, '')
  const baseUrl = client === 'claude' ? rootUrl : `${rootUrl}/v1`
  const close = (open: boolean) => {
    if (!open) useConnectionTour.getState().connectionClosed()
    props.onOpenChange(open)
  }
  const copyCompleted = (kind: 'key' | 'address') => {
    const tour = useConnectionTour.getState()
    if (tour.userId !== tourUserId) return
    if (kind === 'key') tour.keyCopied()
    else tour.addressCopied()
  }
  const codex = getCodexSetup(baseUrl, platform, model)
  const claudeConfig = JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: 'sk-your-api-key',
        ANTHROPIC_MODEL: model,
      },
    },
    null,
    2
  )
  const files =
    client === 'claude'
      ? [
          {
            filename:
              platform === 'windows'
                ? '%USERPROFILE%\\.claude\\settings.json'
                : '~/.claude/settings.json',
            snippet: claudeConfig,
          },
        ]
      : codex.files

  return (
    <Dialog
      open
      modal={!tourActive}
      disablePointerDismissal={tourActive}
      onOpenChange={close}
      title={t('Connect your application manually')}
      description={t('Choose your app, then copy these settings into it.')}
      showCloseButton={false}
      contentClassName={cn(
        'sm:max-w-2xl',
        tourActive && 'connection-manual-tour'
      )}
      footer={
        <Button variant='outline' onClick={() => close(false)}>
          {t('Close')}
        </Button>
      }
    >
      <div data-onboarding-dialog className='space-y-4'>
        <section
          data-onboarding='manual-key'
          className='space-y-4 rounded-lg border p-4'
        >
          <div className='space-y-2'>
            <Label id='manual-application-label'>{t('Application')}</Label>
            <ToggleGroup
              value={[client]}
              aria-labelledby='manual-application-label'
              variant='outline'
              spacing={2}
              className='grid w-full grid-cols-3 gap-2'
              onValueChange={(values) => {
                const value = values.find((candidate) => candidate !== client)
                if (value) setClient(value as Client)
              }}
            >
              <ToggleGroupItem
                value='openai'
                className='min-w-0 text-xs whitespace-normal'
              >
                {t('Other app')}
              </ToggleGroupItem>
              <ToggleGroupItem value='codex' className='min-w-0'>
                Codex
              </ToggleGroupItem>
              <ToggleGroupItem
                value='claude'
                className='min-w-0 whitespace-normal'
              >
                Claude Code
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='min-w-0'>
              <p className='flex items-center gap-2 text-sm font-medium'>
                <KeyRound className='text-primary size-4' aria-hidden='true' />
                {t('API Key')}
              </p>
              <p className='text-muted-foreground mt-1 truncate font-mono text-xs'>
                {props.apiKey.name} · sk-••••••••
              </p>
            </div>
            <CopyButton
              value={props.tokenKey}
              variant='secondary'
              size='sm'
              aria-label={t('Copy API key')}
              onCopied={() => copyCompleted('key')}
            >
              {t('Copy API key')}
            </CopyButton>
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Paste this key into the API key field in your app. Keep it private.'
            )}
          </p>
        </section>

        <section
          data-onboarding='manual-address'
          className='rounded-lg border p-4'
        >
          <div className='flex items-center justify-between gap-3'>
            <Label className='flex items-center gap-2'>
              <Globe className='text-primary size-4' aria-hidden='true' />
              {t('Base URL')}
            </Label>
            <CopyButton
              value={baseUrl}
              size='sm'
              variant='secondary'
              aria-label={t('Copy API URL')}
              onCopied={() => copyCompleted('address')}
            >
              {t('Copy')}
            </CopyButton>
          </div>
          <code className='mt-2 block text-sm break-all select-text'>
            {baseUrl}
          </code>
          <p className='text-muted-foreground mt-2 text-xs leading-5'>
            {t('Paste this into Base URL or API address in your app.')}
          </p>
        </section>

        <section
          data-onboarding='manual-model'
          className='space-y-3 rounded-lg border p-4'
        >
          <Label htmlFor='manual-model'>{t('Model')}</Label>
          <Combobox
            id='manual-model'
            aria-label={t('Model')}
            options={options}
            value={model}
            onValueChange={(value) => setModel(value ?? '')}
            placeholder={isLoading ? t('Loading...') : t('Select a model')}
            disabled={isLoading || isError}
            emptyText={t('No models found')}
          />
          {isError && (
            <div className='flex flex-wrap items-center gap-3' role='alert'>
              <p className='text-destructive text-sm'>
                {t('Failed to load models')}
              </p>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void refetch()}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            {modelAvailable && (
              <CopyButton
                value={model}
                size='sm'
                aria-label={t('Copy model name')}
              >
                {t('Copy model name')}
              </CopyButton>
            )}
            {tourActive && (
              <Button
                size='sm'
                disabled={!modelAvailable}
                onClick={() => useConnectionTour.getState().modelConfirmed()}
              >
                {t('Use this model')}
                <ArrowRight aria-hidden='true' />
              </Button>
            )}
          </div>
        </section>

        {modelAvailable && (
          <section
            data-onboarding='manual-verify'
            className='space-y-4 rounded-lg border p-4'
          >
            <h3 className='flex items-center gap-2 text-sm font-semibold'>
              <Terminal className='text-primary size-4' aria-hidden='true' />
              {t('Finish setup in your app')}
            </h3>
            {client === 'openai' ? (
              <div className='space-y-2 text-sm leading-6'>
                <p>
                  {t(
                    'Open your app settings and choose an OpenAI-compatible provider.'
                  )}
                </p>
                <p>
                  {t(
                    'Paste the API key and Base URL, enter the selected model name, and save.'
                  )}
                </p>
                <p className='text-primary font-mono break-all'>{model}</p>
              </div>
            ) : (
              <>
                <ToggleGroup
                  value={[platform]}
                  aria-label={t('Platform')}
                  variant='outline'
                  spacing={2}
                  onValueChange={(values) => {
                    const value = values.find(
                      (candidate) => candidate !== platform
                    )
                    if (value) setPlatform(value as CodexPlatform)
                  }}
                >
                  <ToggleGroupItem value='windows'>Windows</ToggleGroupItem>
                  <ToggleGroupItem value='unix'>macOS / Linux</ToggleGroupItem>
                </ToggleGroup>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Install the client first. Save the configuration below and replace the placeholder with the key you copied.'
                  )}
                </p>
                <a
                  className='text-primary inline-flex items-center gap-2 text-sm underline underline-offset-4'
                  href={
                    client === 'codex'
                      ? 'https://developers.openai.com/codex/cli/'
                      : 'https://code.claude.com/docs/en/setup'
                  }
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <BookOpen className='size-4' aria-hidden='true' />
                  {t('Client installation guide')}
                </a>
                {files.map((file) => (
                  <div
                    key={file.filename}
                    className='min-w-0 rounded-lg border'
                  >
                    <div className='bg-muted/40 flex items-center justify-between gap-2 border-b px-3 py-2'>
                      <code className='min-w-0 text-xs break-all'>
                        {file.filename}
                      </code>
                      <CopyButton
                        value={file.snippet}
                        aria-label={t('Copy configuration')}
                      />
                    </div>
                    <pre className='max-h-48 overflow-auto p-3 text-xs leading-5'>
                      <code>{file.snippet}</code>
                    </pre>
                  </div>
                ))}
              </>
            )}
            <p className='flex items-start gap-2 text-sm leading-6'>
              <CheckCircle2
                className='text-primary mt-1 size-4 shrink-0'
                aria-hidden='true'
              />
              {t(
                'Restart the app and send a short message. A reply confirms that your connection works.'
              )}
            </p>
          </section>
        )}
      </div>
    </Dialog>
  )
}
