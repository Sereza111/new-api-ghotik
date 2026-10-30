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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type PriceComparisonProps = {
  currentPrices: string[]
  referencePrices?: string[]
  discountPercent?: number | null
  unit?: string
  className?: string
}

function PriceValues(props: { prices: string[] }) {
  return <>{props.prices.join(' / ')}</>
}

export function PriceComparison(props: PriceComparisonProps) {
  const { t } = useTranslation()
  const hasReferencePrices = Boolean(props.referencePrices?.length)

  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', props.className)}>
      <div className='flex flex-wrap items-center gap-1.5'>
        <span
          className='text-foreground font-mono text-sm font-semibold tabular-nums'
          aria-label={t('Our price')}
        >
          <PriceValues prices={props.currentPrices} />
        </span>
        {props.discountPercent != null ? (
          <Badge variant='secondary'>
            {t('-{{discount}}%', { discount: props.discountPercent })}
          </Badge>
        ) : null}
      </div>

      {hasReferencePrices ? (
        <span
          className='text-muted-foreground/55 font-mono text-xs tabular-nums line-through'
          aria-label={t('Official price')}
        >
          <PriceValues prices={props.referencePrices ?? []} />
        </span>
      ) : null}

      {props.unit ? (
        <span className='text-muted-foreground/50 text-[10px]'>
          {props.unit}
        </span>
      ) : null}
    </div>
  )
}
