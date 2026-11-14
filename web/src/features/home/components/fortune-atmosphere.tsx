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

import { useTheme } from '@/context/theme-provider'

export function FortuneAtmosphere() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const canAnimate = window.matchMedia(
      '(min-width: 64rem) and (prefers-reduced-motion: no-preference)'
    ).matches
    if (
      !canvas ||
      resolvedTheme !== 'dark' ||
      !canAnimate ||
      typeof WebGL2RenderingContext === 'undefined'
    ) {
      return
    }

    let cancelled = false
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
    let destroyAtmosphere: (() => void) | undefined

    const startAtmosphere = () => {
      void import('../lib/fortune-wheel-scene')
        .then(({ createFortuneAtmosphere }) => {
          if (cancelled) return
          destroyAtmosphere = createFortuneAtmosphere({ canvas })
        })
        .catch(() => undefined)
    }

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(startAtmosphere, { timeout: 3000 })
    } else {
      timeoutId = globalThis.setTimeout(startAtmosphere, 1200)
    }

    return () => {
      cancelled = true
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId)
      destroyAtmosphere?.()
    }
  }, [resolvedTheme])

  return (
    <canvas
      ref={canvasRef}
      data-testid='fortune-atmosphere'
      className='fortune-atmosphere'
      aria-hidden='true'
    />
  )
}
