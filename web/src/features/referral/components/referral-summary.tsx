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
  Link2,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import type { ReferralOverview } from '../types'
import { ReferralMembership } from './referral-membership'

interface ReferralSummaryProps {
  overview: ReferralOverview
  referralLink: string
  onTransfer: () => void
  transferDisabled: boolean
}

export function ReferralSummary(props: ReferralSummaryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
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
        percent: formatNumber(props.overview.topup_reward_percent, locale),
      }),
    },
    {
      icon: ShieldCheck,
      label: t('Top-up fee discount (except Stripe and Creem)'),
      value: t('{{percent}}%', {
        percent: formatNumber(
          props.overview.level.topup_fee_discount_percent,
          locale
        ),
      }),
    },
  ]

  return (
    <section className='flex min-w-0 flex-col gap-6 sm:gap-8'>
      <ReferralMembership overview={props.overview} />

      <dl className='grid gap-3 sm:grid-cols-3' aria-label={t('Your benefits')}>
        {benefits.map((benefit) => (
          <div
            key={benefit.label}
            className='referral-benefit flex items-start gap-4 rounded-xl border p-4 sm:p-5'
          >
            <IconBadge tone='primary' size='lg'>
              <benefit.icon aria-hidden='true' />
            </IconBadge>
            <div className='flex min-w-0 flex-col gap-2'>
              <dt className='text-muted-foreground order-2 text-xs leading-relaxed'>
                {benefit.label}
              </dt>
              <dd className='text-2xl font-semibold tracking-tight tabular-nums'>
                {benefit.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      <Card className='rounded-xl' data-card-hover='false'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Link2 className='text-primary size-4' aria-hidden='true' />
            {t('Share your link and earn rewards')}
          </CardTitle>
          <CardDescription>
            {t('Copy the link or send it directly in Telegram.')}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-3 xl:flex-row xl:items-end'>
          <label className='min-w-0 flex-1'>
            <span className='mb-1.5 block text-sm font-medium'>
              {t('Your referral link')}
            </span>
            <Input
              value={props.referralLink}
              readOnly
              className='h-11 font-mono text-xs'
            />
          </label>
          <div className='grid grid-cols-2 gap-2 sm:flex'>
            <CopyButton
              value={props.referralLink}
              variant='default'
              size='default'
              className='h-11 gap-2'
              tooltip={t('Copy referral link')}
              aria-label={t('Copy referral link')}
            >
              {t('Copy')}
            </CopyButton>
            <Button
              variant='outline'
              className='h-11 gap-2'
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
              variant='secondary'
              className='col-span-2 h-11 gap-2'
              disabled={props.transferDisabled}
              onClick={props.onTransfer}
            >
              <ArrowRightLeft aria-hidden='true' />
              {t('Transfer to Balance')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
