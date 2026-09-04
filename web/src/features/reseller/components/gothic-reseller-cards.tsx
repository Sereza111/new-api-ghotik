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
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import cardAvaritiaUrl from '../assets/card-avaritia.webp'
import cardInvidiaUrl from '../assets/card-invidia.webp'
import cardLuxuriaUrl from '../assets/card-luxuria.webp'
import cardSuperbiaUrl from '../assets/card-superbia.webp'
import {
  calculateResellerQuote,
  RESELLER_PACKAGE_OPTIONS,
} from '../lib/pricing'
import type { GothicCardsController } from '../lib/reseller-card-fx.js'
import { ResellerPackageCard } from './reseller-package-card'

import '../reseller-card-fx.css'

const CARD_ART = {
  avaritia: cardAvaritiaUrl,
  invidia: cardInvidiaUrl,
  superbia: cardSuperbiaUrl,
  luxuria: cardLuxuriaUrl,
} as const

type GothicResellerCardsProps = {
  tokenMillions: number
  markupPercent: number
  formatMoney: (value: number) => string
  onSelect: (tokenMillions: number) => void
}

export function GothicResellerCards(props: GothicResellerCardsProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLElement>(null)
  const controllerRef = useRef<GothicCardsController | null>(null)
  const selectedIndex = RESELLER_PACKAGE_OPTIONS.findIndex(
    (item) => item.tokenMillions === props.tokenMillions
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof WebGL2RenderingContext === 'undefined') return

    let cancelled = false
    let controller: GothicCardsController | undefined

    void import('../lib/reseller-card-fx.js')
      .then(({ mountGothicCards }) => {
        if (cancelled) return
        controller = mountGothicCards(root, { maxDpr: 1.25 })
        controllerRef.current = controller
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      controller?.destroy()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    controllerRef.current?.setSelected(selectedIndex)
  }, [selectedIndex])

  return (
    <section
      ref={rootRef}
      className='arcana-cards'
      data-arcana-fx
      aria-label={t('Token packages')}
    >
      <div className='arcana-cards__stage' data-arcana-stage>
        <div
          className='arcana-cards__grid'
          role='radiogroup'
          aria-label={t('Token packages')}
        >
          {RESELLER_PACKAGE_OPTIONS.map((item, index) => {
            const packageCost = calculateResellerQuote(
              item.tokenMillions,
              props.markupPercent
            ).cost
            return (
              <ResellerPackageCard
                key={item.id}
                id={item.id}
                tokenMillions={item.tokenMillions}
                numeral={item.numeral}
                scene={item.scene}
                art={CARD_ART[item.scene]}
                cost={props.formatMoney(packageCost)}
                selected={selectedIndex === index}
                featured={item.featured}
                onSelect={() => props.onSelect(item.tokenMillions)}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}
