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
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ROLE } from '@/lib/roles'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

import { ConnectionTour, ConnectionTutorialButton } from '../connection-tour'
import { KeysTourPanel } from '../keys-tour-panel'
import { useConnectionTour } from '../store'

function renderTutorial(user: AuthUser) {
  useAuthStore.getState().auth.setUser(user)
  const root = createRootRoute({
    component: () => (
      <>
        <ConnectionTour />
        <ConnectionTutorialButton />
        <Outlet />
      </>
    ),
  })
  const routeTree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <p>Account home</p>,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/keys',
      component: KeysTourPanel,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/usage-logs',
      component: () => <p>Request history</p>,
    }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  )
  return { ...view, router }
}

function setUser(user: AuthUser | null) {
  act(() => useAuthStore.getState().auth.setUser(user))
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  localStorage.clear()
  useConnectionTour.getState().initialize(null, undefined, 0)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('connection tutorial', () => {
  test('welcomes a new user once, survives StrictMode and can be replayed after skipping', async () => {
    const account = {
      id: 8101,
      username: 'new-user',
      role: ROLE.USER,
      request_count: 0,
    }
    const view = renderTutorial(account)
    expect(
      await screen.findByRole('dialog', {
        name: 'Let us connect your first app',
      })
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    view.unmount()

    // A new layout visit must not automatically reopen the dismissed tutorial.
    useConnectionTour.getState().initialize(null, undefined, 0)
    const replay = renderTutorial(account)
    await screen.findByRole('button', { name: 'Connection tutorial' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connection tutorial' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start walkthrough' })
    )
    const panel = await screen.findByRole('region', {
      name: 'Connection tutorial',
    })
    expect(replay.router.state.location.pathname).toBe('/keys')
    expect(
      within(panel).getByText('Create your API key').closest('li')
    ).toHaveAttribute('aria-current', 'step')
    expect(
      screen.queryByRole('button', { name: 'I received a response' })
    ).not.toBeInTheDocument()
  })

  test('waits for confirmed request count before automatically offering setup', async () => {
    const account = { id: 8102, username: 'loading-user', role: ROLE.USER }
    renderTutorial(account)
    await screen.findByText('Account home')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    setUser({ ...account, request_count: 0 })
    expect(
      await screen.findByRole('dialog', {
        name: 'Let us connect your first app',
      })
    ).toBeVisible()
  })

  test.each([
    { id: 8103, username: 'existing-user', role: ROLE.USER, request_count: 3 },
    { id: 8104, username: 'admin-user', role: ROLE.ADMIN, request_count: 0 },
  ])(
    'does not interrupt $username but keeps manual replay available',
    async (account) => {
      renderTutorial(account)
      const replay = await screen.findByRole('button', {
        name: 'Connection tutorial',
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(replay)
      expect(
        await screen.findByRole('dialog', {
          name: 'Let us connect your first app',
        })
      ).toBeVisible()
    }
  )

  test('resets active steps on identity changes and sign-out without sharing completion', async () => {
    const first = {
      id: 8105,
      username: 'first-user',
      role: ROLE.USER,
      request_count: 0,
    }
    renderTutorial(first)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start walkthrough' })
    )
    await screen.findByRole('region', { name: 'Connection tutorial' })
    act(() => useConnectionTour.getState().keyReady())
    expect(screen.getByText('Connect your app').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )

    setUser({ ...first, id: 8106, username: 'second-user' })
    expect(
      await screen.findByRole('dialog', {
        name: 'Let us connect your first app',
      })
    ).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Connection tutorial' })
    ).not.toBeInTheDocument()
    setUser(first)
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole('region', { name: 'Connection tutorial' })
    ).not.toBeInTheDocument()
    setUser(null)
    expect(
      screen.queryByRole('button', { name: 'Connection tutorial' })
    ).not.toBeInTheDocument()
  })

  test('keeps setup usable with unavailable browser storage and remembers dismissal within the session', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable')
    })
    const account = {
      id: 8107,
      username: 'private-user',
      role: ROLE.USER,
      request_count: 0,
    }
    renderTutorial(account)
    fireEvent.click(await screen.findByRole('button', { name: 'Maybe later' }))
    setUser(null)
    setUser(account)
    await screen.findByRole('button', { name: 'Connection tutorial' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connection tutorial' }))
    expect(
      await screen.findByRole('dialog', {
        name: 'Let us connect your first app',
      })
    ).toBeVisible()
  })

  test('advances from actual key and connection events, supports checking logs, and finishes only on explicit confirmation', async () => {
    const account = {
      id: 8108,
      username: 'connecting-user',
      role: ROLE.USER,
      request_count: 0,
    }
    const { router } = renderTutorial(account)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start walkthrough' })
    )
    await screen.findByRole('region', { name: 'Connection tutorial' })
    act(() => useConnectionTour.getState().keyReady())
    expect(screen.getByText('Connect your app').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
    expect(
      screen.queryByRole('button', { name: 'I received a response' })
    ).not.toBeInTheDocument()
    act(() => useConnectionTour.getState().connectionOpened())
    expect(
      screen.getByText('Try your first request').closest('li')
    ).toHaveAttribute('aria-current', 'step')
    expect(localStorage.getItem('connection-tour:v1:8108')).toBe('seen')

    fireEvent.click(screen.getByRole('button', { name: 'Usage Logs' }))
    await screen.findByText('Request history')
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue connection tutorial' })
    )
    await screen.findByRole('region', { name: 'Connection tutorial' })
    expect(router.state.location.pathname).toBe('/keys')
    fireEvent.click(
      screen.getByRole('button', { name: 'I received a response' })
    )
    expect(
      screen.queryByRole('region', { name: 'Connection tutorial' })
    ).not.toBeInTheDocument()
    expect(localStorage.getItem('connection-tour:v1:8108')).toBe('completed')
    setUser(null)
    setUser(account)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
