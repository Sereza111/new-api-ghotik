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

import { cn } from '@/lib/utils'

type ResellerPackageCardProps = {
  id: string
  tokenMillions: number
  numeral: string
  scene: string
  art: string
  cost: string
  selected: boolean
  featured?: boolean
  onSelect: () => void
}

export function ResellerPackageCard(props: ResellerPackageCardProps) {
  const { t } = useTranslation()

  return (
    <label
      className={cn('arcana-card', props.selected && 'is-selected')}
      data-arcana-card
      data-scene={props.scene}
      data-art={props.art}
    >
      <input
        type='radio'
        name='reseller-token-package'
        value={props.id}
        checked={props.selected}
        aria-label={`${props.tokenMillions}M ${t('Tokens')}`}
        onChange={props.onSelect}
      />
      <img className='arcana-card__fallback' src={props.art} alt='' />
      <span className='arcana-card__roman' aria-hidden='true'>
        {props.numeral}
      </span>
      {props.featured ? (
        <span className='arcana-card__popular'>{t('Most popular')}</span>
      ) : null}
      <span className='arcana-card__meta'>
        <span className='arcana-card__amount'>{props.tokenMillions}M</span>
        <span className='arcana-card__unit'>{t('Tokens')}</span>
        <span className='arcana-card__price'>{props.cost}</span>
      </span>
      <span className='arcana-card__check' aria-hidden='true' />
    </label>
  )
}
