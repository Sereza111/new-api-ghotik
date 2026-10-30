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
  ArrowDown01Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

import type { RoutingFamily } from './types'

// `auto` is reserved by the backend and can never be a selectable source ID.
export const API_KEY_ROUTE_VALUE = 'auto'

type SourceSelectorProps = {
  family: RoutingFamily
  disabled: boolean
  saving: boolean
  onChange: (sourceId: string | null) => void
}

function formatMultiplier(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 4,
  }).format(value)
}

export function SourceSelector(props: SourceSelectorProps) {
  const { t, i18n } = useTranslation()
  const selectedSource = props.family.sources.find(
    (source) => source.id === props.family.selected_source_id
  )
  const selectedValue = selectedSource?.id ?? API_KEY_ROUTE_VALUE
  const automaticLabel = t('Automatic (API key default)')
  const selectItems = [
    { value: API_KEY_ROUTE_VALUE, label: automaticLabel },
    ...props.family.sources.map((source) => ({
      value: source.id,
      label: source.label,
    })),
  ]

  let status = t('API key routing')
  let description = t('Uses the route configured on each API key.')
  if (selectedSource) {
    status = t('Selected')
    description = selectedSource.description || t('No description provided.')
  }

  return (
    <section
      aria-labelledby={`routing-family-${props.family.id}`}
      className='bg-muted/15 flex min-h-52 min-w-0 flex-col gap-3 rounded-lg border p-4'
    >
      <div className='flex min-w-0 items-center justify-between gap-3'>
        <h3
          id={`routing-family-${props.family.id}`}
          className='truncate font-serif text-lg font-semibold'
        >
          {props.family.label}
        </h3>
        <div className='flex shrink-0 items-center gap-2'>
          {props.saving && (
            <Spinner aria-label={t('Saving source preference')} />
          )}
          <Badge variant={selectedSource ? 'secondary' : 'outline'}>
            {status}
          </Badge>
        </div>
      </div>

      <Select
        items={selectItems}
        value={selectedValue}
        disabled={props.disabled}
        onValueChange={(value) => {
          if (value === null) return
          props.onChange(value === API_KEY_ROUTE_VALUE ? null : value)
        }}
      >
        <SelectTrigger
          className='h-10 w-full'
          aria-label={t('Source for {{family}}', {
            family: props.family.label,
          })}
        >
          <SelectValue>{selectedSource?.label ?? automaticLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            <SelectItem value={API_KEY_ROUTE_VALUE}>
              {automaticLabel}
            </SelectItem>
            {props.family.sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>
                <span className='flex min-w-0 flex-1 items-center justify-between gap-3'>
                  <span className='truncate'>{source.label}</span>
                  <span className='text-muted-foreground shrink-0 font-mono text-xs tabular-nums'>
                    ×
                    {formatMultiplier(
                      source.price_multiplier,
                      i18n.resolvedLanguage || 'en'
                    )}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <p className='text-muted-foreground line-clamp-2 min-h-10 text-sm leading-5'>
        {description}
      </p>

      <dl className='mt-auto grid grid-cols-2 gap-3 border-t pt-3'>
        <div className='min-w-0'>
          <dt className='text-muted-foreground text-xs'>{t('Models')}</dt>
          <dd className='mt-1 font-mono text-sm font-medium tabular-nums'>
            {selectedSource?.model_count ?? '—'}
          </dd>
        </div>
        <div className='min-w-0 text-end'>
          <dt className='text-muted-foreground text-xs'>
            {t('Price multiplier')}
          </dt>
          <dd className='mt-1 font-mono text-sm font-medium tabular-nums'>
            {selectedSource
              ? `×${formatMultiplier(
                  selectedSource.price_multiplier,
                  i18n.resolvedLanguage || 'en'
                )}`
              : '—'}
          </dd>
        </div>
      </dl>

      <Collapsible className='group border-t pt-2'>
        <CollapsibleTrigger
          render={
            <button
              type='button'
              className='group/collapsible-trigger text-muted-foreground flex w-full items-center gap-2 text-left text-xs font-medium'
            />
          }
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className='size-4 shrink-0'
            aria-hidden='true'
          />
          <span>{t('Fallback behavior')}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className='ml-auto size-4 shrink-0 transition-transform group-data-[panel-open]/collapsible-trigger:rotate-180'
            aria-hidden='true'
          />
        </CollapsibleTrigger>
        <CollapsibleContent className='text-muted-foreground pt-2 text-xs leading-5'>
          {t('Unavailable models use the API key default route.')}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
