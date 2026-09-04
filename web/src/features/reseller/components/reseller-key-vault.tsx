import { KeyRound, Server, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'

import { RESELLER_ENDPOINT } from '../lib/pricing'
import type { DemoResellerKey, ResellerTerm } from '../types'

type ResellerKeyVaultProps = {
  keys: DemoResellerKey[]
  formatMoney: (value: number) => string
}

const TERM_KEYS: Record<ResellerTerm, string> = {
  unlimited: 'No expiration',
  '7-days': '7 days',
  '30-days': '30 days',
  '90-days': '90 days',
}

function maskDemoKey(value: string): string {
  return `${value.slice(0, 14)}...${value.slice(-4)}`
}

export function ResellerKeyVault(props: ResellerKeyVaultProps) {
  const { t } = useTranslation()

  return (
    <Card data-card-hover='false' className='reseller-tool-card'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <ShieldCheck className='text-primary size-5' aria-hidden='true' />
          {t('Prepared keys')}
        </CardTitle>
        <CardDescription aria-live='polite'>
          {t('Prepared demo keys: {{count}}', { count: props.keys.length })}
        </CardDescription>
        <CardAction>
          <Badge variant='outline'>{t('Preview mode')}</Badge>
        </CardAction>
      </CardHeader>

      {props.keys.length === 0 ? (
        <CardContent className='flex min-h-80'>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <KeyRound aria-hidden='true' />
              </EmptyMedia>
              <EmptyTitle>{t('No reseller keys yet')}</EmptyTitle>
              <EmptyDescription>
                {t(
                  'Prepared demo keys will appear here until you leave this page.'
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      ) : (
        <CardContent className='flex flex-col gap-0 px-0'>
          {props.keys.map((item, index) => (
            <div key={item.id}>
              {index > 0 ? <Separator /> : null}
              <article className='flex flex-col gap-4 px-4 py-5'>
                <header className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='truncate text-base font-semibold'>
                        {item.clientLabel}
                      </h3>
                      <Badge variant='secondary'>{t('Demo key')}</Badge>
                    </div>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {item.tokenMillions}M {t('Tokens')} ·{' '}
                      {t(TERM_KEYS[item.term])}
                    </p>
                  </div>
                  <p className='text-sm font-semibold tabular-nums'>
                    {props.formatMoney(item.clientPrice)}
                  </p>
                </header>

                <div>
                  <div className='mb-2 flex items-center justify-between gap-3 text-xs'>
                    <span className='text-muted-foreground'>
                      {t('Remaining quota')}
                    </span>
                    <span className='font-medium tabular-nums'>
                      {item.tokenMillions}M / {item.tokenMillions}M
                    </span>
                  </div>
                  <Progress value={0} aria-label={t('Used quota')} />
                </div>

                <div className='grid gap-2'>
                  <div className='reseller-secret-row'>
                    <Server
                      className='text-muted-foreground size-4 shrink-0'
                      aria-hidden='true'
                    />
                    <code className='min-w-0 flex-1 truncate'>
                      {RESELLER_ENDPOINT}
                    </code>
                    <CopyButton
                      value={RESELLER_ENDPOINT}
                      tooltip={t('Copy endpoint')}
                      aria-label={t('Copy endpoint')}
                    />
                  </div>
                  <div className='reseller-secret-row'>
                    <KeyRound
                      className='text-muted-foreground size-4 shrink-0'
                      aria-hidden='true'
                    />
                    <code className='min-w-0 flex-1 truncate'>
                      {maskDemoKey(item.key)}
                    </code>
                    <CopyButton
                      value={item.key}
                      tooltip={t('Copy key')}
                      aria-label={t('Copy key')}
                    />
                  </div>
                </div>

                <p className='text-muted-foreground text-xs leading-5'>
                  {t('This key is a preview and cannot send requests.')}
                </p>
              </article>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
