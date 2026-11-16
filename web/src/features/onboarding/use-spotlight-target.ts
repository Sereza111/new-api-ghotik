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
import { useLayoutEffect, useState } from 'react'

import type { ConnectionTourPhase } from './store'

export type SpotlightTarget = {
  element: HTMLElement | null
  left: number
  top: number
  right: number
  bottom: number
  viewportWidth: number
  viewportHeight: number
  formOpen: boolean
  popupOpen: boolean
}

const emptyTarget: SpotlightTarget = {
  element: null,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  formOpen: false,
  popupOpen: false,
}

// A tour must follow the real control through nested table/dialog scrolling.
// Existing popovers cannot expose a clickable hole around an external element.
export function useSpotlightTarget(phase: ConnectionTourPhase) {
  const [target, setTarget] = useState<SpotlightTarget>(emptyTarget)
  useLayoutEffect(() => {
    let frame = 0
    let current: HTMLElement | null = null
    const visible = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].find(
        (element) =>
          element.getClientRects().length > 0 &&
          element.getBoundingClientRect().width > 0
      ) ?? null
    const measure = () => {
      frame = 0
      const form = visible('[data-onboarding="key-form"]')
      const formDialog = form?.closest<HTMLElement>('[role="dialog"]') ?? null
      let element: HTMLElement | null
      if (formDialog && (phase === 'keys' || phase === 'connect')) {
        element = formDialog
      } else if (phase === 'keys') {
        element = visible('[data-onboarding="create-key"]')
      } else if (phase === 'connect') {
        element =
          visible(
            '[data-onboarding="connect-key"][data-onboarding-usable="true"]'
          ) ?? visible('[data-onboarding="create-key"]')
      } else {
        element = visible(
          `[data-onboarding="${phase === 'verify' ? 'manual-verify' : phase}"]`
        )
      }

      const popup = visible('[role="listbox"]')
      const viewportWidth = document.documentElement.clientWidth
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      if (element !== current) {
        current = element
        if (element && element !== formDialog) {
          element.scrollIntoView({
            block: 'center',
            inline: 'center',
            behavior: 'instant',
          })
        }
      }
      const box = element?.getBoundingClientRect()
      const popupBox = popup?.getBoundingClientRect()
      const next: SpotlightTarget = {
        element,
        viewportWidth,
        viewportHeight,
        left: Math.max(6, (box?.left ?? 0) - 6),
        top: Math.max(6, (box?.top ?? 0) - 6),
        right: Math.min(viewportWidth - 6, (box?.right ?? 0) + 6),
        bottom: Math.min(viewportHeight - 6, (box?.bottom ?? 0) + 6),
        formOpen: Boolean(formDialog),
        popupOpen: Boolean(popup),
      }
      if (popupBox && box) {
        next.left = Math.max(6, Math.min(next.left, popupBox.left - 6))
        next.right = Math.min(
          viewportWidth - 6,
          Math.max(next.right, popupBox.right + 6)
        )
        next.top = Math.max(6, Math.min(next.top, popupBox.top - 6))
        next.bottom = Math.min(
          viewportHeight - 6,
          Math.max(next.bottom, popupBox.bottom + 6)
        )
      }
      setTarget((previous) =>
        Object.keys(next).every(
          (key) =>
            previous[key as keyof SpotlightTarget] ===
            next[key as keyof SpotlightTarget]
        )
          ? previous
          : next
      )
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            !(
              mutation.target instanceof Element &&
              mutation.target.closest('[data-tour-layer]')
            )
        )
      ) {
        schedule()
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-open',
        'data-closed',
        'data-onboarding-usable',
        'aria-expanded',
      ],
    })
    const resize = new ResizeObserver(schedule)
    resize.observe(document.body)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, {
      capture: true,
      passive: true,
    })
    window.visualViewport?.addEventListener('resize', schedule)
    measure()
    return () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [phase])
  return target
}
