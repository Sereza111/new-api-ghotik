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
import { afterEach, beforeEach, expect, test } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { STORAGE_KEYS } from '../../../constants'
import type { Message } from '../../../types'
import {
  clearPlaygroundData,
  loadConfig,
  loadMessages,
  loadParameterEnabled,
  sanitizeMessagesForPersistence,
  saveConfig,
  saveMessages,
  saveParameterEnabled,
} from '../storage'

const messages: Message[] = [
  {
    key: 'a-chat',
    from: 'user',
    versions: [{ id: 'a-version', content: 'Account A private chat' }],
  },
]

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

test('switching accounts isolates config, messages and parameter toggles and preserves returning account data', () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
  saveConfig({ model: 'account-a-model' })
  saveMessages(messages)
  saveParameterEnabled({ temperature: true })

  useAuthStore.getState().auth.reset()
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })
  expect(loadConfig()).toEqual({})
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  saveConfig({ model: 'account-b-model' })
  saveMessages([])
  saveParameterEnabled({ temperature: false })

  useAuthStore.getState().auth.setUser({ id: 1, username: 'A', role: 1 })
  expect(loadConfig()).toEqual({ model: 'account-a-model' })
  expect(loadMessages()).toEqual(messages)
  expect(loadParameterEnabled()).toEqual({ temperature: true })

  clearPlaygroundData()
  expect(loadMessages()).toBeNull()
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })
  expect(loadConfig()).toEqual({ model: 'account-b-model' })
  expect(loadMessages()).toEqual([])
  expect(loadParameterEnabled()).toEqual({ temperature: false })
})

test('legacy global data is removed instead of assigned to the first signed-in account', () => {
  localStorage.setItem(
    STORAGE_KEYS.CONFIG,
    JSON.stringify({ model: 'legacy-model' })
  )
  localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages))
  localStorage.setItem(
    STORAGE_KEYS.PARAMETER_ENABLED,
    JSON.stringify({ temperature: true })
  )
  useAuthStore.getState().auth.setUser({ id: 2, username: 'B', role: 1 })

  expect(loadConfig()).toEqual({})
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  for (const key of Object.values(STORAGE_KEYS)) {
    expect(localStorage.getItem(key)).toBeNull()
  }
})

test('storage calls without a signed-in user do not persist shared data', () => {
  saveConfig({ model: 'signed-out-model' })
  saveMessages(messages)
  saveParameterEnabled({ temperature: true })
  expect(loadConfig()).toEqual({})
  expect(loadMessages()).toBeNull()
  expect(loadParameterEnabled()).toEqual({})
  expect(localStorage.length).toBe(0)
})

test('server persistence removes transient media payloads without mutating in-memory messages', () => {
  const messagesWithImages: Message[] = [
    {
      key: 'image-chat',
      from: 'user',
      versions: [{ id: 'image-version', content: 'Use this reference' }],
      inputImages: ['data:image/png;base64,reference'],
      inputFiles: [
        {
          id: 'report',
          filename: 'report.pdf',
          dataUrl: 'data:application/pdf;base64,document',
        },
      ],
      images: [
        {
          id: 'generated-image',
          src: 'data:image/png;base64,result',
          revisedPrompt: 'Revised prompt',
        },
      ],
    },
  ]

  expect(sanitizeMessagesForPersistence(messagesWithImages)).toEqual([
    {
      key: 'image-chat',
      from: 'user',
      versions: [{ id: 'image-version', content: 'Use this reference' }],
    },
  ])
  expect(messagesWithImages[0].inputImages).toHaveLength(1)
  expect(messagesWithImages[0].inputFiles).toHaveLength(1)
  expect(messagesWithImages[0].images).toHaveLength(1)
})

test('comparison configuration and lane metadata persist while transient media is removed', () => {
  useAuthStore.getState().auth.setUser({ id: 3, username: 'C', role: 1 })
  saveConfig({
    comparison: {
      enabled: true,
      model: 'secondary-model',
      group: 'secondary-group',
    },
  })
  saveMessages([
    {
      key: 'secondary-user',
      from: 'user',
      versions: [{ id: 'secondary-version', content: 'Compare this' }],
      lane: 'secondary',
      turnId: 'turn-1',
      inputImages: ['data:image/png;base64,reference'],
      inputFiles: [
        {
          id: 'brief',
          filename: 'brief.pdf',
          dataUrl: 'data:application/pdf;base64,document',
        },
      ],
    },
  ])

  expect(loadConfig()).toEqual({
    comparison: {
      enabled: true,
      model: 'secondary-model',
      group: 'secondary-group',
    },
  })
  expect(loadMessages()).toEqual([
    {
      key: 'secondary-user',
      from: 'user',
      versions: [{ id: 'secondary-version', content: 'Compare this' }],
      lane: 'secondary',
      turnId: 'turn-1',
    },
  ])
})

test('server persistence enforces UTF-8 message and aggregate byte limits', () => {
  const oversizedCyrillic: Message = {
    key: 'oversized-cyrillic',
    from: 'user',
    versions: [
      {
        id: 'oversized-version',
        // This is below the old 40,000-character guard but above 40 KiB in UTF-8.
        content: 'я'.repeat(21 * 1024),
      },
    ],
  }
  expect(sanitizeMessagesForPersistence([oversizedCyrillic])).toEqual([])

  const manyMessages = Array.from({ length: 30 }, (_, index): Message => ({
    key: `message-${index}`,
    from: 'assistant',
    versions: [
      {
        id: `version-${index}`,
        content: 'x'.repeat(39 * 1024),
      },
    ],
  }))
  const persisted = sanitizeMessagesForPersistence(manyMessages)
  const totalBytes = persisted.reduce(
    (total, message) =>
      total + new TextEncoder().encode(JSON.stringify(message)).byteLength,
    0
  )

  expect(persisted.length).toBeLessThan(manyMessages.length)
  expect(persisted.at(-1)?.key).toBe('message-29')
  expect(totalBytes).toBeLessThanOrEqual(1024 * 1024)
})
