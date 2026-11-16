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
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { useConnectionTour, type ConnectionTourPhase } from './store'
import { useSpotlightTarget } from './use-spotlight-target'

export function ConnectionSpotlight(props: { phase: ConnectionTourPhase }) {
  const { t } = useTranslation()
  const target = useSpotlightTarget(props.phase)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(240)
  const originalFocus = useRef(document.activeElement)
  const arrowId = useId()
  const headingId = useId()
  const descriptionId = useId()
  const dismiss = useConnectionTour((state) => state.dismiss)
  const back = useConnectionTour((state) => state.back)
  const finish = useConnectionTour((state) => state.finish)

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const resize = new ResizeObserver(() =>
      setCardHeight(card.getBoundingClientRect().height)
    )
    resize.observe(card)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    const initial = originalFocus.current
    return () => {
      if (initial instanceof HTMLElement && initial.isConnected) {
        initial.focus({ preventScroll: true })
      }
    }
  }, [])

  useEffect(() => {
    const element = target.element
    const focusable =
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
    const first = element?.matches(focusable)
      ? element
      : element?.querySelector<HTMLElement>(focusable)
    if (!target.popupOpen) {
      ;(first ?? cardRef.current)?.focus({ preventScroll: true })
    }
  }, [target.element, target.popupOpen, props.phase])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (target.popupOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      const selector =
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
      const controls = [
        ...(target.element?.matches(selector) ? [target.element] : []),
        ...(target.element?.querySelectorAll<HTMLElement>(selector) ?? []),
        ...(cardRef.current?.querySelectorAll<HTMLElement>(selector) ?? []),
      ].filter(
        (element) =>
          element.getClientRects().length && !element.closest('[inert]')
      )
      if (!controls.length) return
      const index = controls.indexOf(document.activeElement as HTMLElement)
      let next = (index + 1) % controls.length
      if (event.shiftKey) next = index <= 0 ? controls.length - 1 : index - 1
      event.preventDefault()
      controls[next]?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [target.element, target.popupOpen, dismiss])

  let step = 1
  let emoji = '✨'
  let title = t('Start with this button')
  let description = t(
    'Click the highlighted button to create your first API key.'
  )
  if (target.formOpen) {
    emoji = '✍️'
    title = t('Give your key a name')
    description = t(
      'Choose a group, review the limits, then click Save Changes. We will continue when the key is ready.'
    )
  } else if (
    props.phase === 'connect' &&
    target.element?.dataset.onboarding !== 'create-key'
  ) {
    step = 2
    emoji = '👉'
    title = t('Open manual setup here')
    description = t(
      'Click Connect on this key. We will show you what to enter in your application.'
    )
  } else if (props.phase === 'manual-key') {
    step = 3
    emoji = '🔑'
    title = t('Choose your app and copy the key')
    description = t(
      'Pick your application, then copy this key into its API Key field.'
    )
  } else if (props.phase === 'manual-address') {
    step = 4
    emoji = '📍'
    title = t('Now copy the API address')
    description = t(
      'Paste this address into Base URL in your app. Keep the path exactly as shown.'
    )
  } else if (props.phase === 'manual-model') {
    step = 5
    emoji = '🧠'
    title = t('Choose the model you will use')
    description = t(
      'Select an available model, then confirm it to see your manual configuration.'
    )
  } else if (props.phase === 'verify') {
    step = 6
    emoji = '🚀'
    title = t('Make your first connection')
    description = t(
      'Apply these settings in your app and send a short message. Confirm below after you receive a response.'
    )
  }
  const found = Boolean(
    target.element && target.right > target.left && target.bottom > target.top
  )
  const mobile = target.viewportWidth < 768
  const width = Math.min(368, target.viewportWidth - 24)
  let left = Math.max(
    12,
    Math.min(target.left, target.viewportWidth - width - 12)
  )
  let top = target.bottom + 28
  if (mobile) {
    left = 12
    const placeBesideTarget =
      found &&
      !target.formOpen &&
      (props.phase === 'keys' || props.phase === 'connect')
    if (placeBesideTarget) {
      const spaceAbove = target.top - 24
      const spaceBelow = target.viewportHeight - target.bottom - 24
      top =
        spaceBelow >= cardHeight || spaceBelow >= spaceAbove
          ? target.bottom + 12
          : target.top - cardHeight - 12
      top = Math.max(12, Math.min(top, target.viewportHeight - cardHeight - 12))
    } else {
      top = Math.max(12, target.viewportHeight - cardHeight - 12)
    }
  } else if (target.left > width + 48) {
    left = target.left - width - 30
    top = Math.max(
      16,
      Math.min(target.top, target.viewportHeight - cardHeight - 16)
    )
  } else if (target.viewportWidth - target.right > width + 48) {
    left = target.right + 30
    top = Math.max(
      16,
      Math.min(target.top, target.viewportHeight - cardHeight - 16)
    )
  } else if (top + cardHeight > target.viewportHeight - 16) {
    top = Math.max(16, target.top - cardHeight - 28)
  }
  if (!found) {
    left = Math.max(12, (target.viewportWidth - width) / 2)
    top = Math.max(12, (target.viewportHeight - cardHeight) / 2)
  }

  const endX = Math.min(
    Math.max(left + width / 2, target.left + 8),
    target.right - 8
  )
  const endY = top >= target.bottom ? target.bottom + 2 : target.top - 2
  const startX = left + width / 2
  const startY = top >= target.bottom ? top - 4 : top + cardHeight + 4
  return createPortal(
    <div data-tour-layer className='connection-tour-layer'>
      {found ? (
        <>
          <div
            className='connection-tour-shade'
            style={{ left: 0, top: 0, width: '100%', height: target.top }}
          />
          <div
            className='connection-tour-shade'
            style={{ left: 0, top: target.bottom, width: '100%', bottom: 0 }}
          />
          <div
            className='connection-tour-shade'
            style={{
              left: 0,
              top: target.top,
              width: target.left,
              height: target.bottom - target.top,
            }}
          />
          <div
            className='connection-tour-shade'
            style={{
              left: target.right,
              right: 0,
              top: target.top,
              height: target.bottom - target.top,
            }}
          />
          <div
            className='connection-tour-ring'
            style={{
              left: target.left,
              top: target.top,
              width: target.right - target.left,
              height: target.bottom - target.top,
            }}
          />
          {!target.popupOpen && (
            <svg
              className='connection-tour-arrow'
              aria-hidden='true'
              width={target.viewportWidth}
              height={target.viewportHeight}
            >
              <defs>
                <marker
                  id={arrowId}
                  markerWidth='10'
                  markerHeight='10'
                  refX='7'
                  refY='4'
                  orient='auto'
                >
                  <path
                    d='M1,1 L7,4 L1,7'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                  />
                </marker>
              </defs>
              <path
                d={`M ${startX} ${startY} Q ${startX + (endX - startX) * 0.8} ${(startY + endY) / 2} ${endX} ${endY}`}
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                markerEnd={`url(#${arrowId})`}
              />
            </svg>
          )}
        </>
      ) : (
        <div className='connection-tour-shade' style={{ inset: 0 }} />
      )}
      <Card
        ref={cardRef}
        className='connection-tour-coach'
        role='region'
        tabIndex={-1}
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        style={{ left, top, width, maxHeight: target.viewportHeight - 24 }}
      >
        <CardHeader className='gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-primary text-xs font-medium'>
              {t('Step {{current}} of {{total}}', { current: step, total: 6 })}
            </span>
            <Button
              size='icon-sm'
              variant='ghost'
              onClick={dismiss}
              aria-label={t('Stop tutorial')}
            >
              <X aria-hidden='true' />
            </Button>
          </div>
          <CardTitle
            id={headingId}
            className='flex items-center gap-2 text-lg leading-snug'
          >
            <span aria-hidden='true'>{emoji}</span>
            <span>{found ? title : t('Finding the next step')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p
            id={descriptionId}
            className='text-muted-foreground text-sm leading-relaxed'
            aria-live='polite'
          >
            {found
              ? description
              : t(
                  'Keep this page open while the controls load. You can stop and restart the tour at any time.'
                )}
          </p>
          <div className='mt-4 flex gap-1.5' aria-hidden='true'>
            {Array.from({ length: 6 }, (_, index) => (
              <span
                key={index}
                className={
                  index < step
                    ? 'bg-primary h-1 flex-1 rounded-full'
                    : 'bg-muted h-1 flex-1 rounded-full'
                }
              />
            ))}
          </div>
        </CardContent>
        <CardFooter className='flex items-center justify-between gap-2'>
          {['manual-address', 'manual-model', 'verify'].includes(
            props.phase
          ) ? (
            <Button variant='ghost' size='sm' onClick={back}>
              <ArrowLeft aria-hidden='true' />
              {t('Back')}
            </Button>
          ) : (
            <span className='text-muted-foreground text-xs'>
              {t('Follow the highlight')}
            </span>
          )}
          {props.phase === 'verify' ? (
            <Button size='sm' onClick={finish}>
              {t('I received a response')}
              <ArrowRight aria-hidden='true' />
            </Button>
          ) : (
            <Button variant='ghost' size='sm' onClick={dismiss}>
              {t('Maybe later')}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>,
    document.body
  )
}
