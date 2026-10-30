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
import { BadgeCheck, Crown, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

import type { ResellerSubscription } from '../types'

type ResellerSubscriptionBandProps = {
  subscription: ResellerSubscription
  formatMoney: (value: number) => string
  formatExpiry: (value: number) => string
  isPurchasing: boolean
  hasAvailableGroups: boolean
  onPurchase: () => void
}

export function ResellerSubscriptionBand(props: ResellerSubscriptionBandProps) {
  const { t } = useTranslation()
  const hasDiscount =
    props.subscription.discount_percent > 0 &&
    props.subscription.price < props.subscription.list_price
  const title = props.subscription.active
    ? t('Reseller subscription active')
    : t('Unlock reseller key issuance')
  let statusBadge = null
  if (props.subscription.active) {
    statusBadge = <Badge variant='secondary'>{t('Active')}</Badge>
  } else if (hasDiscount) {
    statusBadge = (
      <Badge variant='warning'>
        {t('{{percent}}% discount', {
          percent: props.subscription.discount_percent,
        })}
      </Badge>
    )
  }
  let description = t(
    'Explore packages and configure a key freely. A reseller subscription is required only when issuing it.'
  )
  if (!props.hasAvailableGroups) {
    description = t('No routing groups are available for this account.')
  } else if (props.subscription.active) {
    description = t('Active until {{date}}. You can issue reseller keys.', {
      date: props.formatExpiry(props.subscription.expires_at),
    })
  }

  return (
    <section
      className='border-border/70 grid items-center gap-5 border-y py-5 lg:grid-cols-[minmax(0,1fr)_auto]'
      aria-labelledby='reseller-subscription-title'
    >
      <div className='flex min-w-0 items-start gap-3'>
        <span className='border-primary/30 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center border bg-transparent'>
          {props.subscription.active ? (
            <BadgeCheck className='size-5' aria-hidden='true' />
          ) : (
            <Crown className='size-5' aria-hidden='true' />
          )}
        </span>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3
              id='reseller-subscription-title'
              className='font-serif text-lg font-semibold'
            >
              {title}
            </h3>
            {statusBadge}
          </div>
          <p className='text-muted-foreground mt-1 max-w-3xl text-sm leading-6'>
            {description}
          </p>
        </div>
      </div>

      {!props.subscription.active ? (
        <div className='flex flex-wrap items-center justify-between gap-4 lg:justify-end'>
          <div className='text-left lg:text-right'>
            <div className='flex items-baseline gap-2 lg:justify-end'>
              <span className='font-serif text-xl font-semibold tabular-nums'>
                {props.formatMoney(props.subscription.price)}
              </span>
              {hasDiscount ? (
                <span className='text-muted-foreground text-sm tabular-nums line-through'>
                  {props.formatMoney(props.subscription.list_price)}
                </span>
              ) : null}
            </div>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Access for {{count}} days', {
                count: props.subscription.duration_days,
              })}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type='button'
                  size='lg'
                  disabled={props.isPurchasing || !props.hasAvailableGroups}
                />
              }
            >
              {props.isPurchasing ? (
                <Spinner data-icon='inline-start' aria-hidden='true' />
              ) : (
                <WalletCards data-icon='inline-start' aria-hidden='true' />
              )}
              {props.isPurchasing
                ? t('Purchasing...')
                : t('Purchase with balance')}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('Confirm reseller subscription purchase')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    '{{price}} will be charged from your balance for {{count}} days of reseller access.',
                    {
                      price: props.formatMoney(props.subscription.price),
                      count: props.subscription.duration_days,
                    }
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={props.isPurchasing}>
                  {t('Cancel')}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={props.isPurchasing}
                  onClick={props.onPurchase}
                >
                  {props.isPurchasing ? (
                    <Spinner data-icon='inline-start' aria-hidden='true' />
                  ) : (
                    <WalletCards data-icon='inline-start' aria-hidden='true' />
                  )}
                  {props.isPurchasing
                    ? t('Purchasing...')
                    : t('Confirm purchase')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </section>
  )
}
