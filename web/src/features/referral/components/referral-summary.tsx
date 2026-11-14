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
  ArrowRightLeft,
  BadgePercent,
  Gift,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { formatQuota } from '@/lib/format'

import type { ReferralOverview } from '../types'

interface ReferralSummaryProps {
  overview: ReferralOverview
  referralLink: string
  onTransfer: () => void
  transferDisabled: boolean
}

const LEVEL_NAMES: Record<string, string> = {
  starter: 'Starter',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
}

export function ReferralSummary(props: ReferralSummaryProps) {
  const { t } = useTranslation()
  const levelName = t(
    LEVEL_NAMES[props.overview.level.code] ?? props.overview.level.name
  )
  const progress = Math.min(
    100,
    Math.max(0, props.overview.level.progress_percent)
  )
  const isHighestLevel = props.overview.level.next_threshold == null
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    props.referralLink
  )}&text=${encodeURIComponent(t('Join through my referral link'))}`

  const benefits = [
    {
      icon: Gift,
      label: t('Channel subscription reward'),
      value: formatQuota(props.overview.channel_reward_quota),
    },
    {
      icon: BadgePercent,
      label: t('Reward from invited user top-ups'),
      value: t('{{percent}}%', {
        percent: props.overview.topup_reward_percent,
      }),
    },
    {
      icon: ShieldCheck,
      label: t('Top-up fee discount (except Stripe and Creem)'),
      value: t('{{percent}}%', {
        percent: props.overview.level.topup_fee_discount_percent,
      }),
    },
  ]

  return (
    <section className='overflow-hidden rounded-md border'>
      <div className='grid lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]'>
        <div className='border-b p-5 lg:border-r lg:border-b-0'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='text-muted-foreground text-xs font-medium uppercase'>
                {t('Referral level and benefits')}
              </p>
              <h2 className='mt-1 font-serif text-2xl font-semibold'>
                {levelName}
              </h2>
            </div>
            <StatusBadge
              label={t('Level {{level}}', { level: levelName })}
              variant='info'
              copyable={false}
            />
          </div>

          <Progress value={isHighestLevel ? 100 : progress} className='mt-7'>
            <ProgressLabel>
              {isHighestLevel
                ? t('Highest referral level reached')
                : t('{{current}} of {{target}} qualified referrals', {
                    current: props.overview.qualified_count,
                    target: props.overview.level.next_threshold,
                  })}
            </ProgressLabel>
            <ProgressValue>
              {() =>
                t('{{percent}}% complete', {
                  percent: isHighestLevel ? 100 : Math.round(progress),
                })
              }
            </ProgressValue>
          </Progress>
        </div>

        <div className='divide-y px-5'>
          {benefits.map((benefit) => (
            <div
              key={benefit.label}
              className='flex min-h-16 items-center gap-3 py-3'
            >
              <benefit.icon
                className='text-primary size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='text-muted-foreground min-w-0 flex-1 text-sm'>
                {benefit.label}
              </span>
              <span className='shrink-0 font-medium tabular-nums'>
                {benefit.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className='border-t p-4 sm:p-5'>
        <div className='flex flex-col gap-3 xl:flex-row xl:items-end'>
          <label className='min-w-0 flex-1'>
            <span className='mb-1.5 block text-sm font-medium'>
              {t('Your referral link')}
            </span>
            <Input
              value={props.referralLink}
              readOnly
              className='font-mono text-xs'
            />
          </label>
          <div className='grid grid-cols-2 gap-2 sm:flex'>
            <CopyButton
              value={props.referralLink}
              variant='outline'
              size='default'
              className='h-10 gap-2'
              tooltip={t('Copy referral link')}
              aria-label={t('Copy referral link')}
            >
              {t('Copy')}
            </CopyButton>
            <Button
              variant='outline'
              className='h-10 gap-2'
              disabled={!props.referralLink}
              render={
                <a
                  href={telegramShareUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                />
              }
            >
              <Send aria-hidden='true' />
              {t('Telegram')}
            </Button>
            <Button
              className='col-span-2 h-10 gap-2'
              disabled={props.transferDisabled}
              onClick={props.onTransfer}
            >
              <ArrowRightLeft aria-hidden='true' />
              {t('Transfer to Balance')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
