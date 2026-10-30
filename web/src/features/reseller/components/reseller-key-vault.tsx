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
import {
  CircleAlert,
  Eye,
  KeyRound,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { GroupBadge } from '@/components/group-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type {
  ResellerKey,
  ResellerQuotaAdjustmentRequest,
  ResellerTerm,
} from '../types'
import { ResellerQuotaDialog } from './reseller-quota-dialog'

type ResellerKeyVaultProps = {
  keys: ResellerKey[]
  formatMoney: (value: number) => string
  revealedKeys: Record<number, string>
  revealingKeyId: number | null
  deletingKeyId: number | null
  reissuingKeyId: number | null
  adjustingKeyId: number | null
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  errorMessage?: string
  onRetry: () => void
  onReveal: (id: number) => void
  onDelete: (id: number) => Promise<boolean>
  onReissue: (id: number) => Promise<boolean>
  onAdjustQuota: (
    id: number,
    request: ResellerQuotaAdjustmentRequest
  ) => Promise<boolean>
}

type PendingKeyAction = {
  type: 'delete' | 'reissue'
  key: ResellerKey
}

const TERM_KEYS: Record<ResellerTerm, string> = {
  unlimited: 'No expiration',
  '7-days': '7 days',
  '30-days': '30 days',
  '90-days': '90 days',
}

const STATUS_KEYS: Record<number, string> = {
  1: 'Enabled',
  2: 'Disabled',
  3: 'Expired',
  4: 'Exhausted',
}

const KEY_SKELETON_IDS = ['key-1', 'key-2', 'key-3']

function formatTokenMillions(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0M'
  const millions = tokens / 1_000_000
  return `${Number(millions.toFixed(2))}M`
}

function getRemainingPercent(item: ResellerKey): number {
  const total = item.used_tokens + item.remaining_tokens
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (item.remaining_tokens / total) * 100))
}

export function ResellerKeyVault(props: ResellerKeyVaultProps) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<PendingKeyAction | null>(
    null
  )
  const [quotaKeyId, setQuotaKeyId] = useState<number | null>(null)
  const quotaKey = props.keys.find((item) => item.id === quotaKeyId) ?? null
  const isDeleteAction = pendingAction?.type === 'delete'
  const isActionLoading = Boolean(
    pendingAction &&
    (isDeleteAction
      ? props.deletingKeyId === pendingAction.key.id
      : props.reissuingKeyId === pendingAction.key.id)
  )
  const keyActionIsPending =
    props.deletingKeyId !== null ||
    props.reissuingKeyId !== null ||
    props.adjustingKeyId !== null
  const actionKeyName = pendingAction?.key.client_label ?? ''
  const actionTitle = isDeleteAction
    ? t('Delete reseller key "{{name}}"?', { name: actionKeyName })
    : t('Reissue reseller key "{{name}}"?', { name: actionKeyName })
  const actionDescription = isDeleteAction
    ? t(
        'The key will stop working immediately. Its remaining token quota will be permanently discarded and will not be refunded.'
      )
    : t(
        'The current secret will stop working immediately. Quota, group, and expiration will remain unchanged.'
      )
  let actionConfirmText = isDeleteAction ? t('Delete key') : t('Reissue key')
  if (isActionLoading) {
    actionConfirmText = isDeleteAction
      ? t('Deleting key...')
      : t('Reissuing key...')
  }

  const handleActionConfirm = async () => {
    if (!pendingAction) return

    const completed = isDeleteAction
      ? await props.onDelete(pendingAction.key.id)
      : await props.onReissue(pendingAction.key.id)
    if (completed) setPendingAction(null)
  }

  const handleActionDialogOpenChange = (open: boolean) => {
    if (!open && !isActionLoading) setPendingAction(null)
  }

  let content: ReactNode
  if (props.isLoading) {
    content = (
      <CardContent aria-label={t('Loading reseller keys')}>
        <div className='flex flex-col gap-4 py-3'>
          {KEY_SKELETON_IDS.map((id) => (
            <div key={id} className='flex flex-col gap-3'>
              <div className='flex items-center justify-between gap-4'>
                <Skeleton className='h-5 w-40' />
                <Skeleton className='h-5 w-16' />
              </div>
              <Skeleton className='h-2 w-full' />
              <Skeleton className='h-9 w-full' />
            </div>
          ))}
        </div>
      </CardContent>
    )
  } else if (props.isError) {
    content = (
      <CardContent className='flex min-h-80 items-center'>
        <Alert variant='destructive' className='bg-transparent'>
          <CircleAlert aria-hidden='true' />
          <AlertTitle>{t('Failed to load reseller keys')}</AlertTitle>
          <AlertDescription className='flex flex-col items-start gap-3'>
            <span>{props.errorMessage || t('Try again in a moment.')}</span>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={props.isFetching}
              onClick={props.onRetry}
            >
              {props.isFetching ? (
                <Spinner data-icon='inline-start' aria-hidden='true' />
              ) : (
                <RefreshCw data-icon='inline-start' aria-hidden='true' />
              )}
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </CardContent>
    )
  } else if (props.keys.length === 0) {
    content = (
      <CardContent className='flex min-h-80'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <KeyRound aria-hidden='true' />
            </EmptyMedia>
            <EmptyTitle>{t('No reseller keys yet')}</EmptyTitle>
            <EmptyDescription>
              {t('Issued reseller keys will appear here.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
    )
  } else {
    content = (
      <CardContent className='flex flex-col gap-0 px-0'>
        {props.keys.map((item, index) => {
          const revealedKey = props.revealedKeys[item.id]
          const isRevealing = props.revealingKeyId === item.id
          const isDeleting = props.deletingKeyId === item.id
          const isReissuing = props.reissuingKeyId === item.id
          let keyAction: ReactNode

          if (revealedKey) {
            keyAction = (
              <CopyButton
                value={revealedKey}
                tooltip={t('Copy key')}
                aria-label={t('Copy key')}
              />
            )
          } else {
            keyAction = (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={props.revealingKeyId !== null || keyActionIsPending}
                onClick={() => props.onReveal(item.id)}
              >
                {isRevealing ? (
                  <Spinner data-icon='inline-start' aria-hidden='true' />
                ) : (
                  <Eye data-icon='inline-start' aria-hidden='true' />
                )}
                {t('Reveal key')}
              </Button>
            )
          }

          return (
            <div key={item.id}>
              {index > 0 ? <Separator /> : null}
              <article className='flex flex-col gap-4 px-4 py-5'>
                <header className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='truncate text-base font-semibold'>
                        {item.client_label}
                      </h3>
                      <Badge variant='secondary'>
                        {t(STATUS_KEYS[item.status] || 'Unknown')}
                      </Badge>
                      <GroupBadge group={item.group} size='sm' />
                    </div>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {item.token_millions}M {t('Tokens')} ·{' '}
                      {t(TERM_KEYS[item.term])}
                    </p>
                  </div>
                  <div className='flex shrink-0 items-start gap-1'>
                    <div className='mr-1 text-right'>
                      <p className='text-sm font-semibold tabular-nums'>
                        {props.formatMoney(item.client_price)}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {t('Client price')}
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            disabled={
                              keyActionIsPending ||
                              props.revealingKeyId !== null
                            }
                            aria-label={
                              isReissuing
                                ? t('Reissuing key...')
                                : t('Reissue key')
                            }
                            onClick={() =>
                              setPendingAction({ type: 'reissue', key: item })
                            }
                          />
                        }
                      >
                        {isReissuing ? (
                          <Spinner aria-hidden='true' />
                        ) : (
                          <RotateCw aria-hidden='true' />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>{t('Reissue key')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            disabled={
                              keyActionIsPending ||
                              props.revealingKeyId !== null
                            }
                            aria-label={t('Adjust quota')}
                            onClick={() => setQuotaKeyId(item.id)}
                          />
                        }
                      >
                        {props.adjustingKeyId === item.id ? (
                          <Spinner aria-hidden='true' />
                        ) : (
                          <SlidersHorizontal aria-hidden='true' />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>{t('Adjust quota')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            className='text-destructive hover:text-destructive'
                            disabled={
                              keyActionIsPending ||
                              props.revealingKeyId !== null
                            }
                            aria-label={
                              isDeleting
                                ? t('Deleting key...')
                                : t('Delete key')
                            }
                            onClick={() =>
                              setPendingAction({ type: 'delete', key: item })
                            }
                          />
                        }
                      >
                        {isDeleting ? (
                          <Spinner aria-hidden='true' />
                        ) : (
                          <Trash2 aria-hidden='true' />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>{t('Delete key')}</TooltipContent>
                    </Tooltip>
                  </div>
                </header>

                <div>
                  <div className='mb-2 flex items-center justify-between gap-3 text-xs'>
                    <span className='text-muted-foreground'>
                      {t('Remaining quota')}
                    </span>
                    <span className='font-medium tabular-nums'>
                      {formatTokenMillions(item.remaining_tokens)} /{' '}
                      {item.token_millions}M
                    </span>
                  </div>
                  <Progress
                    value={getRemainingPercent(item)}
                    aria-label={t('Remaining quota')}
                  />
                </div>

                <div className='grid gap-2'>
                  <div className='reseller-secret-row'>
                    <Server
                      className='text-muted-foreground size-4 shrink-0'
                      aria-hidden='true'
                    />
                    <code className='min-w-0 flex-1 truncate'>
                      {item.endpoint}
                    </code>
                    <CopyButton
                      value={item.endpoint}
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
                      {revealedKey || item.key}
                    </code>
                    {keyAction}
                  </div>
                </div>
              </article>
            </div>
          )
        })}
      </CardContent>
    )
  }

  return (
    <>
      <Card data-card-hover='false' className='reseller-tool-card h-full'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <ShieldCheck className='text-primary size-5' aria-hidden='true' />
            {t('Reseller keys')}
          </CardTitle>
          <CardDescription aria-live='polite'>
            {t('Issued keys: {{count}}', { count: props.keys.length })}
          </CardDescription>
          <CardAction>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={props.isFetching}
              onClick={props.onRetry}
            >
              <RefreshCw
                data-icon='inline-start'
                className={props.isFetching ? 'animate-spin' : undefined}
                aria-hidden='true'
              />
              {props.isFetching ? t('Refreshing...') : t('Refresh')}
            </Button>
          </CardAction>
        </CardHeader>

        {content}
      </Card>

      <ConfirmDialog
        destructive={isDeleteAction}
        open={pendingAction !== null}
        onOpenChange={handleActionDialogOpenChange}
        handleConfirm={() => void handleActionConfirm()}
        isLoading={isActionLoading}
        disabled={!pendingAction}
        className='max-w-md'
        title={actionTitle}
        desc={actionDescription}
        confirmText={actionConfirmText}
      />

      {quotaKey ? (
        <ResellerQuotaDialog
          open
          keyName={quotaKey.client_label}
          remainingTokens={quotaKey.remaining_tokens}
          totalTokens={quotaKey.token_millions * 1_000_000}
          baseCostPerMillion={quotaKey.base_cost_per_million}
          formatMoney={props.formatMoney}
          isSubmitting={props.adjustingKeyId === quotaKey.id}
          onOpenChange={(open) => {
            if (!open && props.adjustingKeyId === null) setQuotaKeyId(null)
          }}
          onAdjust={(request) => props.onAdjustQuota(quotaKey.id, request)}
        />
      ) : null}
    </>
  )
}
