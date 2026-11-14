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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import type { Message, PlaygroundSessionDetail } from '../../types'
import { usePlaygroundState } from '../use-playground-state'

const apiMocks = vi.hoisted(() => ({
  createPlaygroundSession: vi.fn(),
  deletePlaygroundSession: vi.fn(),
  getPlaygroundSession: vi.fn(),
  listPlaygroundSessions: vi.fn(),
  updatePlaygroundSession: vi.fn(),
}))

vi.mock('../../api', () => apiMocks)

const session = (
  id: string,
  revision = 1,
  messages: Message[] = []
): PlaygroundSessionDetail => ({
  id,
  title: `${id} title`,
  model: 'gpt-test',
  message_count: messages.length,
  revision,
  created_at: 1,
  updated_at: revision,
  config: {
    model: 'gpt-test',
    group: 'default',
    temperature: 0.7,
    top_p: 1,
    max_tokens: 4096,
    frequency_penalty: 0,
    presence_penalty: 0,
    seed: null,
    stream: true,
    reasoning_effort: 'none',
    web_search_enabled: false,
    comparison: {
      enabled: false,
      model: '',
      group: 'default',
    },
  },
  parameter_enabled: {
    temperature: true,
    top_p: true,
    max_tokens: false,
    frequency_penalty: true,
    presence_penalty: true,
    seed: false,
  },
  messages,
})

const message = (key: string): Message => ({
  key,
  from: 'user',
  versions: [{ id: `${key}-version`, content: key }],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.getState().auth.reset()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'first-user', role: 1 })
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

test.each(['New conversation', 'A custom title'])(
  'titles %s only when it is an unnamed conversation',
  async (title) => {
    const first = { ...session('first-session'), title }
    apiMocks.listPlaygroundSessions.mockResolvedValue([first])
    apiMocks.getPlaygroundSession.mockResolvedValue(first)
    apiMocks.updatePlaygroundSession.mockResolvedValue({
      ...first,
      revision: 2,
    })
    const hook = renderHook(() => usePlaygroundState(), {
      wrapper: createWrapper(),
    })
    await waitFor(() =>
      expect(hook.result.current.activeSessionId).toBe(first.id)
    )
    act(() =>
      hook.result.current.updateMessages([
        message('Repair the welding power supply'),
      ])
    )
    act(() => window.dispatchEvent(new Event('pagehide')))
    await waitFor(() =>
      expect(apiMocks.updatePlaygroundSession).toHaveBeenCalled()
    )
    const update = apiMocks.updatePlaygroundSession.mock.calls[0][1]
    if (title === 'New conversation') {
      expect(update.title).toBe('Repair the welding power supply')
    } else expect(update).not.toHaveProperty('title')
  }
)

test('restores all interrupted cloud turns without displaying a permanent loader', async () => {
  const first = session('first-session', 1, [
    {
      key: 'primary',
      from: 'assistant',
      versions: [{ id: 'one', content: '' }],
      status: 'loading',
    },
    {
      key: 'secondary',
      from: 'assistant',
      versions: [{ id: 'two', content: 'Partial answer' }],
      status: 'streaming',
      lane: 'secondary',
    },
  ])
  apiMocks.listPlaygroundSessions.mockResolvedValue([first])
  apiMocks.getPlaygroundSession.mockResolvedValue(first)
  const hook = renderHook(() => usePlaygroundState(), {
    wrapper: createWrapper(),
  })
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(first.id)
  )
  expect(hook.result.current.messages.map((item) => item.status)).toEqual([
    'error',
    'complete',
  ])
  expect(hook.result.current.messages[1].versions[0].content).toBe(
    'Partial answer'
  )
})

test('does not restore hidden legacy generation limits', async () => {
  const first = session('first-session')
  first.parameter_enabled.max_tokens = true
  first.parameter_enabled.temperature = true
  apiMocks.listPlaygroundSessions.mockResolvedValue([first])
  apiMocks.getPlaygroundSession.mockResolvedValue(first)
  const hook = renderHook(() => usePlaygroundState(), {
    wrapper: createWrapper(),
  })
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(first.id)
  )
  expect(hook.result.current.parameterEnabled.max_tokens).toBe(false)
  expect(hook.result.current.parameterEnabled.temperature).toBe(false)
})

test('ignores an in-flight save after deleting its session', async () => {
  const first = session('first-session')
  const second = session('second-session')
  const lateSave = deferred<PlaygroundSessionDetail>()
  apiMocks.listPlaygroundSessions.mockResolvedValue([first, second])
  apiMocks.getPlaygroundSession.mockImplementation(async (id: string) =>
    id === first.id ? first : second
  )
  apiMocks.updatePlaygroundSession
    .mockImplementationOnce(() => lateSave.promise)
    .mockResolvedValueOnce(session(second.id, 2, [message('second-edit')]))
  apiMocks.deletePlaygroundSession.mockResolvedValue(undefined)

  const hook = renderHook(() => usePlaygroundState(), {
    wrapper: createWrapper(),
  })
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(first.id)
  )

  vi.useFakeTimers()
  act(() => hook.result.current.updateMessages([message('first-edit')]))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(apiMocks.updatePlaygroundSession).toHaveBeenCalledWith(
    first.id,
    expect.any(Object),
    {}
  )

  await act(async () => {
    await hook.result.current.removeSession(first.id)
  })
  expect(hook.result.current.activeSessionId).toBe(second.id)

  await act(async () => {
    lateSave.resolve(session(first.id, 2, [message('first-edit')]))
    await lateSave.promise
  })
  expect(hook.result.current.activeSessionId).toBe(second.id)

  act(() => hook.result.current.updateMessages([message('second-edit')]))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  expect(apiMocks.updatePlaygroundSession).toHaveBeenLastCalledWith(
    second.id,
    expect.any(Object),
    {}
  )
  expect(hook.result.current.sessionSaveStatus).toBe('saved')
})

test('ignores an in-flight save after the authenticated user changes', async () => {
  const first = session('first-user-session')
  const second = session('second-user-session')
  const lateSave = deferred<PlaygroundSessionDetail>()
  apiMocks.listPlaygroundSessions
    .mockResolvedValueOnce([first])
    .mockResolvedValueOnce([second])
  apiMocks.getPlaygroundSession.mockImplementation(async (id: string) =>
    id === first.id ? first : second
  )
  apiMocks.updatePlaygroundSession.mockImplementationOnce(
    () => lateSave.promise
  )

  const hook = renderHook(() => usePlaygroundState(), {
    wrapper: createWrapper(),
  })
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(first.id)
  )

  vi.useFakeTimers()
  act(() => hook.result.current.updateMessages([message('first-edit')]))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })

  act(() => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 2, username: 'second-user', role: 1 })
  })
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(second.id)
  )

  await act(async () => {
    lateSave.resolve(session(first.id, 2, [message('first-edit')]))
    await lateSave.promise
  })
  expect(hook.result.current.activeSessionId).toBe(second.id)
  expect(hook.result.current.sessionSaveStatus).toBe('saved')
})

test('flushes a pending edit with keepalive when the page is hidden', async () => {
  const first = session('first-session')
  apiMocks.listPlaygroundSessions.mockResolvedValue([first])
  apiMocks.getPlaygroundSession.mockResolvedValue(first)
  apiMocks.updatePlaygroundSession.mockResolvedValue(
    session(first.id, 2, [message('pending-edit')])
  )

  const hook = renderHook(() => usePlaygroundState(), {
    wrapper: createWrapper(),
  })
  await waitFor(() =>
    expect(hook.result.current.activeSessionId).toBe(first.id)
  )

  act(() => hook.result.current.updateMessages([message('pending-edit')]))
  act(() => window.dispatchEvent(new Event('pagehide')))

  await waitFor(() =>
    expect(apiMocks.updatePlaygroundSession).toHaveBeenCalledWith(
      first.id,
      expect.any(Object),
      { keepalive: true }
    )
  )
  await waitFor(() =>
    expect(hook.result.current.sessionSaveStatus).toBe('saved')
  )
})
