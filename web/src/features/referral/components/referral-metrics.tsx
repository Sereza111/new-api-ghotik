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
import { BadgeCheck, Clock3, Gift, Users, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import type { ReferralOverview } from '../types'

export function ReferralMetrics(props: { overview: ReferralOverview }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const metrics = [
    {
      label: t('Registered'),
      value: formatNumber(props.overview.registered_count, locale),
      icon: Users,
    },
    {
      label: t('Qualified'),
      value: formatNumber(props.overview.qualified_count, locale),
      icon: BadgeCheck,
    },
    {
      label: t('Available Rewards'),
      value: formatQuota(props.overview.available_quota),
      icon: WalletCards,
    },
    {
      label: t('Pending'),
      value: formatQuota(props.overview.pending_quota),
      icon: Clock3,
    },
    {
      label: t('Lifetime Rewards'),
      value: formatQuota(props.overview.lifetime_quota),
      icon: Gift,
    },
  ]

  return (
    <dl
      className='grid grid-cols-2 gap-3 lg:grid-cols-5'
      aria-label={t('Referral activity')}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className='referral-metric flex min-w-0 flex-col gap-4 rounded-xl border p-4 last:col-span-2 sm:p-5 lg:last:col-span-1'
        >
          <div className='flex items-start justify-between gap-3'>
            <dt className='text-muted-foreground text-xs leading-relaxed font-medium'>
              {metric.label}
            </dt>
            <metric.icon
              className='text-primary size-4 shrink-0'
              aria-hidden='true'
            />
          </div>
          <dd className='text-2xl font-medium tracking-tight break-words tabular-nums'>
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
