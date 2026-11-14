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

import { formatQuota } from '@/lib/format'

import type { ReferralOverview } from '../types'

export function ReferralMetrics({ overview }: { overview: ReferralOverview }) {
  const { t } = useTranslation()
  const metrics = [
    {
      label: t('Registered'),
      value: overview.registered_count.toLocaleString(),
      icon: Users,
    },
    {
      label: t('Qualified'),
      value: overview.qualified_count.toLocaleString(),
      icon: BadgeCheck,
    },
    {
      label: t('Available Rewards'),
      value: formatQuota(overview.available_quota),
      icon: WalletCards,
    },
    {
      label: t('Pending'),
      value: formatQuota(overview.pending_quota),
      icon: Clock3,
    },
    {
      label: t('Lifetime Rewards'),
      value: formatQuota(overview.lifetime_quota),
      icon: Gift,
    },
  ]

  return (
    <section className='bg-border grid gap-px overflow-hidden rounded-md border sm:grid-cols-2 xl:grid-cols-5'>
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className='bg-background flex min-h-24 items-center gap-3 p-4'
        >
          <metric.icon
            className='text-primary size-4 shrink-0'
            aria-hidden='true'
          />
          <div className='min-w-0'>
            <p className='text-muted-foreground truncate text-xs font-medium uppercase'>
              {metric.label}
            </p>
            <p className='mt-1 truncate text-xl font-semibold tabular-nums'>
              {metric.value}
            </p>
          </div>
        </div>
      ))}
    </section>
  )
}
