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
import { create } from 'zustand'

import { ROLE } from '@/lib/roles'

export type ConnectionTourPhase =
  | 'idle'
  | 'welcome'
  | 'keys'
  | 'connect'
  | 'verify'

type ConnectionTourState = {
  userId: number | null
  phase: ConnectionTourPhase
  assessed: boolean
  initialize: (
    userId: number | null,
    requestCount: number | undefined,
    role: number
  ) => void
  showWelcome: (userId: number) => void
  start: () => void
  dismiss: () => void
  keyReady: () => void
  connectionOpened: () => void
  finish: () => void
}

// Only the tutorial status is stored. API credentials never enter this store.
const seenInSession = new Set<number>()
const storageKey = (userId: number) => `connection-tour:v1:${userId}`

function rememberTutorial(userId: number, status: 'seen' | 'completed') {
  seenInSession.add(userId)
  try {
    localStorage.setItem(storageKey(userId), status)
  } catch {
    // The tutorial remains usable when browser storage is disabled or full.
  }
}

export const useConnectionTour = create<ConnectionTourState>((set, get) => ({
  userId: null,
  phase: 'idle',
  assessed: false,
  initialize(userId, requestCount, role) {
    const current = get()
    if (userId !== current.userId) {
      set({ userId, phase: 'idle', assessed: false })
    }
    if (userId === null || get().assessed || requestCount === undefined) return
    let seen = seenInSession.has(userId)
    try {
      seen ||= localStorage.getItem(storageKey(userId)) !== null
    } catch {
      // Session memory prevents repeated prompts without localStorage.
    }
    set({ assessed: true })
    if (role === ROLE.USER && requestCount === 0 && !seen) {
      rememberTutorial(userId, 'seen')
      set({ phase: 'welcome' })
    }
  },
  showWelcome(userId) {
    rememberTutorial(userId, 'seen')
    set({ userId, assessed: true, phase: 'welcome' })
  },
  start() {
    if (get().userId !== null) set({ phase: 'keys' })
  },
  dismiss() {
    const userId = get().userId
    if (userId !== null) rememberTutorial(userId, 'seen')
    set({ phase: 'idle' })
  },
  keyReady() {
    if (get().phase === 'keys') set({ phase: 'connect' })
  },
  connectionOpened() {
    if (get().phase === 'connect') set({ phase: 'verify' })
  },
  finish() {
    const state = get()
    if (state.userId === null || state.phase !== 'verify') return
    rememberTutorial(state.userId, 'completed')
    set({ phase: 'idle' })
  },
}))
