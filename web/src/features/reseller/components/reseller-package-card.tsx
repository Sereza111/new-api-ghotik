import { Check, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import fortuneReferenceUrl from '@/assets/fortune-reference.png'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ResellerPackageCardProps = {
  tokenMillions: number
  numeral: string
  cost: string
  selected: boolean
  featured?: boolean
  onSelect: () => void
}

export function ResellerPackageCard(props: ResellerPackageCardProps) {
  const { t } = useTranslation()

  return (
    <button
      type='button'
      className={cn(
        'reseller-package-card group relative isolate flex min-h-64 w-full flex-col overflow-hidden rounded-md border p-4 text-left outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-3',
        props.selected && 'is-selected'
      )}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <img
        src={fortuneReferenceUrl}
        alt=''
        aria-hidden='true'
        className='reseller-package-art'
      />
      <div className='relative flex items-start justify-between gap-3'>
        <span className='reseller-package-numeral'>{props.numeral}</span>
        {props.featured ? (
          <Badge variant='secondary' className='gap-1'>
            <Sparkles aria-hidden='true' />
            {t('Most popular')}
          </Badge>
        ) : null}
      </div>

      <div className='relative mt-auto'>
        <p className='font-serif text-4xl leading-none font-semibold tabular-nums'>
          {props.tokenMillions}M
        </p>
        <p className='text-muted-foreground mt-1 text-xs font-medium uppercase'>
          {t('Tokens')}
        </p>
        <div className='mt-4 flex items-end justify-between gap-3 border-t pt-3'>
          <div>
            <p className='text-muted-foreground text-xs'>{t('Cost')}</p>
            <p className='mt-0.5 text-base font-semibold tabular-nums'>
              {props.cost}
            </p>
          </div>
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full border transition-colors',
              props.selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background/70 text-transparent'
            )}
            aria-hidden='true'
          >
            <Check className='size-4' />
          </span>
        </div>
      </div>
    </button>
  )
}
