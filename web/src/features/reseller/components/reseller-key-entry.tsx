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
  Eye,
  KeyRound,
  RotateCw,
  Server,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { GroupBadge } from '@/components/group-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { ResellerKey, ResellerTerm } from '../types'

type ResellerKeyEntryProps = {
  item: ResellerKey
  formatMoney: (value: number) => string
  revealedKey?: string
  isRevealing: boolean
  isDeleting: boolean
  isReissuing: boolean
  isAdjusting: boolean
  actionsDisabled: boolean
  onReveal: () => void
  onRequestDelete: () => void
  onRequestReissue: () => void
  onRequestAdjust: () => void
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

export function ResellerKeyEntry(props: ResellerKeyEntryProps) {
  const { t } = useTranslation()
  let keyAction: ReactNode

  if (props.revealedKey) {
    keyAction = (
      <CopyButton
        value={props.revealedKey}
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
        disabled={props.actionsDisabled}
        onClick={props.onReveal}
      >
        {props.isRevealing ? (
          <Spinner data-icon='inline-start' aria-hidden='true' />
        ) : (
          <Eye data-icon='inline-start' aria-hidden='true' />
        )}
        {t('Reveal key')}
      </Button>
    )
  }

  return (
    <article className='reseller-key-entry flex flex-col gap-4 px-4 py-5'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h4 className='truncate text-base font-semibold'>
              {props.item.client_label}
            </h4>
            <Badge variant='secondary'>
              {t(STATUS_KEYS[props.item.status] || 'Unknown')}
            </Badge>
            <GroupBadge group={props.item.group} size='sm' />
          </div>
          <p className='text-muted-foreground mt-1 text-xs'>
            {props.item.token_millions}M {t('Tokens')} ·{' '}
            {t(TERM_KEYS[props.item.term])}
          </p>
        </div>
        <div className='flex shrink-0 items-start gap-1'>
          <div className='mr-1 text-right'>
            <p className='text-sm font-semibold tabular-nums'>
              {props.formatMoney(props.item.client_price)}
            </p>
            <p className='text-muted-foreground text-xs'>{t('Client price')}</p>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  disabled={props.actionsDisabled}
                  aria-label={
                    props.isReissuing ? t('Reissuing key...') : t('Reissue key')
                  }
                  onClick={props.onRequestReissue}
                />
              }
            >
              {props.isReissuing ? (
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
                  disabled={props.actionsDisabled}
                  aria-label={t('Adjust quota')}
                  onClick={props.onRequestAdjust}
                />
              }
            >
              {props.isAdjusting ? (
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
                  disabled={props.actionsDisabled}
                  aria-label={
                    props.isDeleting ? t('Deleting key...') : t('Delete key')
                  }
                  onClick={props.onRequestDelete}
                />
              }
            >
              {props.isDeleting ? (
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
          <span className='text-muted-foreground'>{t('Remaining quota')}</span>
          <span className='font-medium tabular-nums'>
            {formatTokenMillions(props.item.remaining_tokens)} /{' '}
            {props.item.token_millions}M
          </span>
        </div>
        <Progress
          value={getRemainingPercent(props.item)}
          aria-label={t('Remaining quota')}
        />
      </div>

      <div className='grid gap-2'>
        <div className='reseller-secret-row'>
          <Server
            className='text-muted-foreground size-4 shrink-0'
            aria-hidden='true'
          />
          <code className='min-w-0 flex-1 truncate'>{props.item.endpoint}</code>
          <CopyButton
            value={props.item.endpoint}
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
            {props.revealedKey || props.item.key}
          </code>
          {keyAction}
        </div>
      </div>
    </article>
  )
}
