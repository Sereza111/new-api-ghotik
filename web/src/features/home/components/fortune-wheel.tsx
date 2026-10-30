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

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import fortuneReferenceUrl from '@/assets/fortune-reference.png'

const ORBIT_MARKERS = Array.from({ length: 4 }, (_, index) => index)

export function FortuneWheel() {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLElement>(null)
  const artRef = useRef<HTMLCanvasElement>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    const artCanvas = artRef.current
    if (!host || !artCanvas || typeof WebGL2RenderingContext === 'undefined') {
      return
    }

    let cancelled = false
    let started = false
    let destroyScene: (() => void) | undefined

    const startScene = async () => {
      if (started) return
      started = true

      try {
        const { createFortuneEngraving } =
          await import('../lib/fortune-wheel-scene')
        if (cancelled) return
        destroyScene = createFortuneEngraving({
          host,
          artCanvas,
          imageUrl: fortuneReferenceUrl,
          onReady: setIsReady,
        })
      } catch {
        setIsReady(false)
      }
    }

    const visibilityObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              if (entry?.isIntersecting) {
                void startScene()
                visibilityObserver?.disconnect()
              }
            },
            { rootMargin: '160px' }
          )

    if (visibilityObserver) visibilityObserver.observe(host)
    else void startScene()

    return () => {
      cancelled = true
      visibilityObserver?.disconnect()
      destroyScene?.()
    }
  }, [])

  return (
    <figure
      ref={hostRef}
      data-fortune-ready={isReady}
      className='fortune-scene text-foreground relative isolate mx-auto aspect-square w-full max-w-[30rem]'
      aria-label={t('Gothic Wheel of Fortune')}
    >
      <div
        data-testid='fortune-wheel-frame'
        className='fortune-oracle-frame'
        aria-hidden='true'
      >
        <div className='fortune-diamond fortune-diamond-a' />
        <div className='fortune-diamond fortune-diamond-b' />
        <div className='fortune-orbit fortune-orbit-outer'>
          {ORBIT_MARKERS.map((marker) => (
            <i key={marker} />
          ))}
        </div>
        <div className='fortune-orbit fortune-orbit-inner'>
          {ORBIT_MARKERS.map((marker) => (
            <i key={marker} />
          ))}
        </div>
        <span className='fortune-sigil fortune-sigil-n'>I</span>
        <span className='fortune-sigil fortune-sigil-e'>II</span>
        <span className='fortune-sigil fortune-sigil-s'>III</span>
        <span className='fortune-sigil fortune-sigil-w'>IV</span>
      </div>

      <div className='fortune-living-engraving' aria-hidden='true'>
        <img
          data-testid='fortune-wheel-fallback'
          className='fortune-oracle-fallback'
          src={fortuneReferenceUrl}
          alt=''
        />
        <canvas
          ref={artRef}
          data-testid='fortune-wheel-art'
          className='fortune-oracle-art'
        />
      </div>

      <figcaption className='fortune-caption' aria-hidden='true'>
        VL · FORTUNA <span>FIG. X</span>
      </figcaption>
    </figure>
  )
}
