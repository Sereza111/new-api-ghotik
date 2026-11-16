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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ROLE } from '@/lib/roles'

let ConnectionSpotlight: typeof import('../connection-spotlight').ConnectionSpotlight
let useConnectionTour: typeof import('../store').useConnectionTour
let spotlightFixture: HTMLDivElement

function SpotlightHarness() {
  const phase = useConnectionTour((state) => state.phase)
  if (phase === 'idle' || phase === 'welcome') return null
  return <ConnectionSpotlight phase={phase} />
}

function addSpotlightButton(
  onboarding: string,
  label: string,
  rect = { left: 120, top: 80, width: 180, height: 40 }
) {
  const button = document.createElement('button')
  const box = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  } as DOMRect
  const rects = Object.assign([box], {
    item: (index: number) => (index === 0 ? box : null),
  }) as DOMRectList

  button.type = 'button'
  button.dataset.onboarding = onboarding
  button.textContent = label
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(box)
  vi.spyOn(button, 'getClientRects').mockReturnValue(rects)
  spotlightFixture.append(button)
  return button
}

function advanceToVerification() {
  const tour = useConnectionTour.getState()
  tour.keyReady()
  tour.connectionOpened()
  tour.keyCopied()
  tour.addressCopied()
  tour.modelConfirmed()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  useConnectionTour = (await import('../store')).useConnectionTour
})

describe('connection tutorial lifecycle', () => {
  test('offers a new user setup once and permits replay after dismissal', () => {
    const tour = useConnectionTour.getState()
    tour.initialize(8101, 0, ROLE.USER)
    tour.initialize(8101, 0, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('welcome')

    tour.dismiss()
    tour.initialize(null, undefined, 0)
    tour.initialize(8101, 0, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('idle')

    tour.showWelcome(8101)
    tour.start()
    expect(useConnectionTour.getState().phase).toBe('keys')
  })

  test('waits for a confirmed request count before offering setup', () => {
    const tour = useConnectionTour.getState()
    tour.initialize(8102, undefined, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('idle')
    tour.initialize(8102, 0, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('welcome')
  })

  test.each([
    { userId: 8103, role: ROLE.USER, requests: 3, account: 'experienced user' },
    { userId: 8104, role: ROLE.ADMIN, requests: 0, account: 'administrator' },
  ])(
    'does not interrupt an $account but permits manual replay',
    ({ userId, role, requests }) => {
      const tour = useConnectionTour.getState()
      tour.initialize(userId, requests, role)
      expect(useConnectionTour.getState().phase).toBe('idle')
      tour.showWelcome(userId)
      expect(useConnectionTour.getState().phase).toBe('welcome')
    }
  )

  test('resets an active walkthrough on account changes and sign-out', () => {
    const tour = useConnectionTour.getState()
    tour.initialize(8105, 0, ROLE.USER)
    tour.start()
    tour.keyReady()
    tour.connectionOpened()
    tour.keyCopied()

    tour.initialize(8106, 0, ROLE.USER)
    expect(useConnectionTour.getState()).toMatchObject({
      userId: 8106,
      phase: 'welcome',
    })
    tour.initialize(8105, 0, ROLE.USER)
    expect(useConnectionTour.getState()).toMatchObject({
      userId: 8105,
      phase: 'idle',
    })
    tour.initialize(null, undefined, 0)
    tour.keyCopied()
    tour.modelConfirmed()
    tour.finish()
    expect(useConnectionTour.getState()).toMatchObject({
      userId: null,
      phase: 'idle',
    })
    expect(localStorage.getItem('connection-tour:v1:8105')).toBe('seen')
  })

  test('remembers dismissal within the session when browser storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    const tour = useConnectionTour.getState()
    tour.initialize(8107, 0, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('welcome')
    tour.dismiss()
    tour.initialize(null, undefined, 0)
    tour.initialize(8107, 0, ROLE.USER)
    expect(useConnectionTour.getState().phase).toBe('idle')
    tour.showWelcome(8107)
    expect(useConnectionTour.getState().phase).toBe('welcome')
  })

  test('ignores a delayed start after the user has dismissed the welcome', () => {
    const tour = useConnectionTour.getState()
    tour.initialize(8108, 0, ROLE.USER)
    tour.dismiss()
    tour.start()
    expect(useConnectionTour.getState().phase).toBe('idle')
  })

  test.each(['seen', 'completed'])(
    'does not prompt again after a saved %s status on a fresh page',
    (status) => {
      localStorage.setItem('connection-tour:v1:8109', status)
      useConnectionTour.getState().initialize(8109, 0, ROLE.USER)
      expect(useConnectionTour.getState().phase).toBe('idle')
    }
  )
})

describe('manual connection progress', () => {
  beforeEach(() => {
    const tour = useConnectionTour.getState()
    tour.initialize(8110, 0, ROLE.USER)
    tour.start()
    tour.keyReady()
    tour.connectionOpened()
  })

  test('requires copying the key and address and confirming the model before verification', () => {
    const tour = useConnectionTour.getState()
    expect(useConnectionTour.getState().phase).toBe('manual-key')
    tour.addressCopied()
    tour.modelConfirmed()
    tour.finish()
    expect(useConnectionTour.getState().phase).toBe('manual-key')
    tour.keyCopied()
    expect(useConnectionTour.getState().phase).toBe('manual-address')
    tour.modelConfirmed()
    expect(useConnectionTour.getState().phase).toBe('manual-address')
    tour.addressCopied()
    expect(useConnectionTour.getState().phase).toBe('manual-model')
    tour.finish()
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('seen')
    tour.modelConfirmed()
    expect(useConnectionTour.getState().phase).toBe('verify')
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('seen')
    tour.finish()
    expect(useConnectionTour.getState().phase).toBe('idle')
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('completed')
  })

  test('returns through previous manual steps without marking setup completed', () => {
    const tour = useConnectionTour.getState()
    tour.keyCopied()
    tour.addressCopied()
    tour.modelConfirmed()
    tour.back()
    expect(useConnectionTour.getState().phase).toBe('manual-model')
    tour.back()
    expect(useConnectionTour.getState().phase).toBe('manual-address')
    tour.back()
    expect(useConnectionTour.getState().phase).toBe('manual-key')
    tour.back()
    expect(useConnectionTour.getState().phase).toBe('manual-key')
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('seen')
  })

  test('returns to key selection after closing setup and ignores late clipboard events', () => {
    const tour = useConnectionTour.getState()
    tour.keyCopied()
    tour.connectionClosed()
    tour.addressCopied()
    expect(useConnectionTour.getState().phase).toBe('connect')
    tour.connectionOpened()
    expect(useConnectionTour.getState().phase).toBe('manual-key')
    tour.keyCopied()
    tour.addressCopied()
    tour.modelConfirmed()
    tour.connectionClosed()
    expect(useConnectionTour.getState().phase).toBe('connect')
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('seen')
  })

  test('does not resume or complete a tutorial after the user stops it', () => {
    const tour = useConnectionTour.getState()
    tour.dismiss()
    tour.keyCopied()
    tour.addressCopied()
    tour.modelConfirmed()
    tour.connectionClosed()
    tour.finish()
    expect(useConnectionTour.getState().phase).toBe('idle')
    expect(localStorage.getItem('connection-tour:v1:8110')).toBe('seen')
  })
})

describe('connection spotlight', () => {
  beforeEach(async () => {
    ConnectionSpotlight = (await import('../connection-spotlight'))
      .ConnectionSpotlight
    spotlightFixture = document.createElement('div')
    document.body.append(spotlightFixture)
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1024,
    })

    const tour = useConnectionTour.getState()
    tour.initialize(8120, 0, ROLE.USER)
    tour.start()
  })

  afterEach(() => {
    spotlightFixture.remove()
  })

  test('shows a loading coach until the current phase target appears, then focuses it', async () => {
    render(<SpotlightHarness />)

    expect(
      await screen.findByRole('region', { name: 'Finding the next step' })
    ).toBeVisible()

    const createKey = addSpotlightButton('create-key', 'Create API key')

    expect(
      await screen.findByRole('region', { name: 'Start with this button' })
    ).toBeVisible()
    await waitFor(() => expect(createKey).toHaveFocus())
    expect(document.querySelector('.connection-tour-ring')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeVisible()
  })

  test('keeps the connect phase on key creation until a usable key action appears', async () => {
    useConnectionTour.getState().keyReady()
    const createKey = addSpotlightButton('create-key', 'Create API key')
    const connectKey = addSpotlightButton('connect-key', 'Connect key', {
      left: 720,
      top: 160,
      width: 120,
      height: 32,
    })
    connectKey.dataset.onboardingUsable = 'false'
    render(<SpotlightHarness />)

    expect(
      await screen.findByRole('region', { name: 'Start with this button' })
    ).toBeVisible()
    await waitFor(() => expect(createKey).toHaveFocus())

    connectKey.dataset.onboardingUsable = 'true'

    expect(
      await screen.findByRole('region', { name: 'Open manual setup here' })
    ).toBeVisible()
    await waitFor(() => expect(connectKey).toHaveFocus())
    expect(screen.getByText('Step 2 of 6')).toBeVisible()
  })

  test('returns from verification to the model spotlight through Back', async () => {
    advanceToVerification()
    const model = addSpotlightButton('manual-model', 'Choose model')
    addSpotlightButton('manual-verify', 'Verify connection', {
      left: 520,
      top: 280,
      width: 240,
      height: 120,
    })
    const user = userEvent.setup()
    render(<SpotlightHarness />)

    expect(
      await screen.findByRole('region', { name: 'Make your first connection' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(useConnectionTour.getState().phase).toBe('manual-model')
    expect(
      await screen.findByRole('region', {
        name: 'Choose the model you will use',
      })
    ).toBeVisible()
    await waitFor(() => expect(model).toHaveFocus())
    expect(
      screen.queryByRole('button', { name: 'I received a response' })
    ).not.toBeInTheDocument()
  })

  test('completes the tutorial only from the verification confirmation', async () => {
    advanceToVerification()
    addSpotlightButton('manual-verify', 'Verify connection', {
      left: 520,
      top: 280,
      width: 240,
      height: 120,
    })
    const user = userEvent.setup()
    render(<SpotlightHarness />)

    await user.click(
      await screen.findByRole('button', { name: 'I received a response' })
    )

    await waitFor(() =>
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    )
    expect(useConnectionTour.getState().phase).toBe('idle')
    expect(localStorage.getItem('connection-tour:v1:8120')).toBe('completed')
  })
})
