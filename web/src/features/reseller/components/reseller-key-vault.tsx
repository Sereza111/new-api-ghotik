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
  ChevronDown,
  CircleAlert,
  KeyRound,
  RefreshCw,
  Search,
  SearchX,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

import type { ResellerKey, ResellerQuotaAdjustmentRequest } from '../types'
import { ResellerKeyEntry } from './reseller-key-entry'
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

type ResellerKeyBucket = {
  tokenMillions: number
  keys: ResellerKey[]
  activeCount: number
  clientValue: number
  newestCreatedTime: number
}

const STATUS_KEYS: Record<number, string> = {
  1: 'Enabled',
  2: 'Disabled',
  3: 'Expired',
  4: 'Exhausted',
}

const KEY_SKELETON_IDS = ['key-1', 'key-2', 'key-3']

export function ResellerKeyVault(props: ResellerKeyVaultProps) {
  const { t } = useTranslation()
  const [pendingAction, setPendingAction] = useState<PendingKeyAction | null>(
    null
  )
  const [quotaKeyId, setQuotaKeyId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
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

  const buckets = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
    const grouped = new Map<number, ResellerKey[]>()

    for (const key of props.keys) {
      if (statusFilter !== 'all' && key.status !== Number(statusFilter)) {
        continue
      }
      if (normalizedSearch) {
        const searchable = [
          key.client_label,
          key.group,
          key.key,
          key.endpoint,
          `${key.token_millions}m`,
        ]
          .join(' ')
          .toLocaleLowerCase()
        if (!searchable.includes(normalizedSearch)) continue
      }

      const bucket = grouped.get(key.token_millions) ?? []
      bucket.push(key)
      grouped.set(key.token_millions, bucket)
    }

    const result: ResellerKeyBucket[] = []
    for (const [tokenMillions, keys] of grouped) {
      keys.sort((a, b) => b.created_time - a.created_time)
      result.push({
        tokenMillions,
        keys,
        activeCount: keys.filter((key) => key.status === 1).length,
        clientValue: keys.reduce(
          (total, key) =>
            total + (Number.isFinite(key.client_price) ? key.client_price : 0),
          0
        ),
        newestCreatedTime: keys[0]?.created_time ?? 0,
      })
    }
    result.sort(
      (a, b) =>
        b.newestCreatedTime - a.newestCreatedTime ||
        a.tokenMillions - b.tokenMillions
    )
    return result
  }, [props.keys, searchQuery, statusFilter])
  const filteredKeyCount = buckets.reduce(
    (total, bucket) => total + bucket.keys.length,
    0
  )
  const filtersActive = searchQuery.trim() !== '' || statusFilter !== 'all'

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

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
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
      <CardContent className='px-0'>
        <div className='grid gap-2 border-y p-4 sm:grid-cols-[minmax(0,1fr)_11rem]'>
          <label className='relative block'>
            <span className='sr-only'>{t('Search reseller keys')}</span>
            <Search
              className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2'
              aria-hidden='true'
            />
            <Input
              type='search'
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('Search by client, key, group, or quota')}
              className='pl-8'
            />
          </label>
          <NativeSelect
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label={t('Filter by status')}
            className='w-full'
          >
            <NativeSelectOption value='all'>
              {t('All statuses')}
            </NativeSelectOption>
            {Object.entries(STATUS_KEYS).map(([status, label]) => (
              <NativeSelectOption key={status} value={status}>
                {t(label)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        {filteredKeyCount === 0 ? (
          <Empty className='min-h-72'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <SearchX aria-hidden='true' />
              </EmptyMedia>
              <EmptyTitle>
                {t('No reseller keys match your filters.')}
              </EmptyTitle>
              <EmptyDescription>
                {t('Try another client name, quota, group, or status.')}
              </EmptyDescription>
            </EmptyHeader>
            <Button type='button' variant='outline' onClick={clearFilters}>
              {t('Clear filters')}
            </Button>
          </Empty>
        ) : (
          <div aria-label={t('Keys grouped by quota')}>
            {buckets.map((bucket, bucketIndex) => (
              <Collapsible
                key={`${bucket.tokenMillions}-${bucket.keys[0]?.id ?? 0}-${filtersActive ? 'filtered' : 'all'}`}
                defaultOpen={bucketIndex === 0 || filtersActive}
                className='group/key-bucket border-b last:border-b-0'
              >
                <CollapsibleTrigger className='group hover:bg-muted/40 flex w-full items-center justify-between gap-4 px-4 py-3 text-left'>
                  <span className='flex min-w-0 items-center gap-2'>
                    <span className='font-serif text-lg font-semibold tabular-nums'>
                      {bucket.tokenMillions}M
                    </span>
                    <Badge variant='secondary'>
                      {t('{{count}} keys', { count: bucket.keys.length })}
                    </Badge>
                    <span className='text-muted-foreground hidden text-xs sm:inline'>
                      {t('{{count}} active', { count: bucket.activeCount })}
                    </span>
                  </span>
                  <span className='flex shrink-0 items-center gap-3'>
                    <span className='text-right'>
                      <span className='block text-xs font-semibold tabular-nums'>
                        {props.formatMoney(bucket.clientValue)}
                      </span>
                      <span className='text-muted-foreground block text-[0.68rem]'>
                        {t('Issued key value')}
                      </span>
                    </span>
                    <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className='border-t'>
                    {bucket.keys.map((item, index) => (
                      <div key={item.id}>
                        {index > 0 ? <Separator /> : null}
                        <ResellerKeyEntry
                          item={item}
                          formatMoney={props.formatMoney}
                          revealedKey={props.revealedKeys[item.id]}
                          isRevealing={props.revealingKeyId === item.id}
                          isDeleting={props.deletingKeyId === item.id}
                          isReissuing={props.reissuingKeyId === item.id}
                          isAdjusting={props.adjustingKeyId === item.id}
                          actionsDisabled={
                            keyActionIsPending || props.revealingKeyId !== null
                          }
                          onReveal={() => props.onReveal(item.id)}
                          onRequestDelete={() =>
                            setPendingAction({ type: 'delete', key: item })
                          }
                          onRequestReissue={() =>
                            setPendingAction({ type: 'reissue', key: item })
                          }
                          onRequestAdjust={() => setQuotaKeyId(item.id)}
                        />
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    )
  }

  return (
    <>
      <Card data-card-hover='false' className='reseller-tool-card'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <ShieldCheck className='text-primary size-5' aria-hidden='true' />
            {t('Reseller keys')}
          </CardTitle>
          <CardDescription aria-live='polite'>
            {t('Showing {{shown}} of {{total}} keys', {
              shown: filteredKeyCount,
              total: props.keys.length,
            })}
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
