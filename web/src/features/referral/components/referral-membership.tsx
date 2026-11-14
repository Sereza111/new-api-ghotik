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
import { ArrowUpRight, Check, Crown, LockKeyhole, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ReferralOverview } from '../types'

// Presentation only: qualification thresholds and discounts come from the API.
const MEMBERSHIP_LEVELS = [
  { code: 'starter', name: 'Starter' },
  { code: 'bronze', name: 'Bronze' },
  { code: 'silver', name: 'Silver' },
  { code: 'gold', name: 'Gold' },
]

export function ReferralMembership(props: { overview: ReferralOverview }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const level = props.overview.level
  const currentIndex = MEMBERSHIP_LEVELS.findIndex(
    (item) => item.code === level.code
  )
  const levelName = t(MEMBERSHIP_LEVELS[currentIndex]?.name ?? level.name)
  const isHighestLevel = level.next_threshold == null
  const progress = isHighestLevel
    ? 100
    : Math.min(100, Math.max(0, level.progress_percent))
  const remaining = Math.max(
    0,
    (level.next_threshold ?? 0) - props.overview.qualified_count
  )

  return (
    <div className='grid min-w-0 gap-7 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-10'>
      <Card
        className='referral-member-card'
        data-tier={level.code}
        data-card-hover='false'
      >
        <div className='referral-member-orbit' aria-hidden='true' />
        <CardHeader className='relative flex flex-row items-center justify-between gap-3'>
          <span className='text-xs font-medium tracking-[0.2em] uppercase'>
            VL · {t('Membership')}
          </span>
          <Sparkles className='size-5 opacity-70' aria-hidden='true' />
        </CardHeader>
        <CardContent className='relative flex flex-1 items-center justify-between gap-5 py-5'>
          <div className='min-w-0'>
            <p className='mb-2 text-xs opacity-75'>{t('Your current level')}</p>
            <h2 className='font-serif text-4xl font-medium tracking-tight break-words sm:text-5xl'>
              {levelName}
            </h2>
          </div>
          <div className='referral-member-emblem' aria-hidden='true'>
            <Crown className='size-8 sm:size-10' strokeWidth={1.25} />
          </div>
        </CardContent>
        <CardFooter className='referral-member-footer relative flex-wrap justify-between gap-4'>
          <div className='min-w-0'>
            <p className='mb-1 text-[10px] tracking-wider uppercase opacity-70'>
              {t('Referral code')}
            </p>
            <p className='truncate font-mono text-sm tracking-[0.12em]'>
              {props.overview.referral_code}
            </p>
          </div>
          <div className='text-right'>
            <p className='mb-1 text-[10px] tracking-wider uppercase opacity-70'>
              {t('Qualified')}
            </p>
            <p className='text-lg font-medium tabular-nums'>
              {formatNumber(props.overview.qualified_count, locale)}
            </p>
          </div>
        </CardFooter>
      </Card>

      <div className='flex min-w-0 flex-col gap-6'>
        <div>
          <Badge
            variant='secondary'
            className='mb-3 h-auto max-w-full gap-1.5 whitespace-normal'
          >
            <Sparkles aria-hidden='true' />
            {t('Referral level and benefits')}
          </Badge>
          <h2 className='font-serif text-3xl leading-tight tracking-tight sm:text-4xl'>
            {t('Your circle, your privileges.')}
          </h2>
          <p className='text-muted-foreground mt-3 max-w-lg text-sm leading-relaxed'>
            {t(
              'Every qualified invitation brings you closer to your next level.'
            )}
          </p>
        </div>

        <div className='flex flex-col gap-3'>
          <Progress value={progress} className='referral-level-progress'>
            <ProgressLabel>
              {isHighestLevel
                ? t('Highest referral level reached')
                : t('{{current}} of {{target}} qualified referrals', {
                    current: formatNumber(
                      props.overview.qualified_count,
                      locale
                    ),
                    target: formatNumber(level.next_threshold, locale),
                  })}
            </ProgressLabel>
            <ProgressValue>
              {() =>
                t('{{percent}}%', {
                  percent: formatNumber(Math.round(progress), locale),
                })
              }
            </ProgressValue>
          </Progress>
          {!isHighestLevel ? (
            <p className='text-muted-foreground flex items-center gap-2 text-xs leading-relaxed'>
              <ArrowUpRight
                className='text-primary size-3.5 shrink-0'
                aria-hidden='true'
              />
              {t('{{count}} more qualified referrals to the next level', {
                count: remaining,
              })}
            </p>
          ) : null}
        </div>

        {currentIndex >= 0 ? (
          <ol
            className='referral-levels grid grid-cols-2 gap-2 sm:grid-cols-4'
            aria-label={t('Referral levels')}
          >
            {MEMBERSHIP_LEVELS.map((item, index) => {
              const isCurrent = index === currentIndex
              const unlocked = index <= currentIndex
              let status = t('Locked')
              if (isCurrent) status = t('Your current level')
              else if (unlocked) status = t('Unlocked')
              else if (index === currentIndex + 1) status = t('Next level')

              return (
                <li
                  key={item.code}
                  className='referral-level'
                  data-tier={item.code}
                  aria-current={isCurrent ? 'step' : undefined}
                  data-unlocked={unlocked}
                >
                  <div className='mb-3 flex items-center justify-between gap-2'>
                    <span
                      className='referral-level-material'
                      aria-hidden='true'
                    />
                    {unlocked ? (
                      <Check
                        className='text-primary size-3.5'
                        aria-hidden='true'
                      />
                    ) : (
                      <LockKeyhole
                        className='text-muted-foreground size-3'
                        aria-hidden='true'
                      />
                    )}
                  </div>
                  <p className='text-sm font-semibold'>{t(item.name)}</p>
                  <p className='text-muted-foreground mt-1 text-[11px] leading-snug'>
                    {status}
                  </p>
                </li>
              )
            })}
          </ol>
        ) : null}
      </div>
    </div>
  )
}
