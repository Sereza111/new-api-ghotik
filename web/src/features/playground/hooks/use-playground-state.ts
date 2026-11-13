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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorStatus } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  createPlaygroundSession,
  deletePlaygroundSession,
  getPlaygroundSession,
  listPlaygroundSessions,
  updatePlaygroundSession,
} from '../api'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import {
  applyMessageStateUpdate,
  clearStoredMessages,
  getInitialParameterEnabled,
  getInitialPlaygroundConfig,
  loadMessages,
  sanitizeMessagesForPersistence,
  saveConfig,
  saveParameterEnabled,
  type MessageStateUpdater,
} from '../lib'
import type {
  GroupOption,
  Message,
  ModelOption,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundSessionDetail,
  PlaygroundSessionSummary,
} from '../types'

const SESSION_SAVE_DEBOUNCE_MS = 500

type SessionSnapshot = {
  config: PlaygroundConfig
  parameter_enabled: ParameterEnabled
  messages: Message[]
}

type SessionSaveStatus = 'saved' | 'saving' | 'error'

type SessionSaveOptions = {
  keepalive?: boolean
}

type InFlightSessionSave = {
  epoch: number
  sessionId: string
  request: Promise<PlaygroundSessionDetail>
}

const sessionListQueryKey = (userId: number | undefined) =>
  ['playground', 'sessions', userId] as const

const sessionDetailQueryKey = (userId: number | undefined, sessionId: string) =>
  ['playground', 'session', userId, sessionId] as const

function toSessionSummary(
  session: PlaygroundSessionDetail
): PlaygroundSessionSummary {
  const { id, title, model, message_count, revision, created_at, updated_at } =
    session
  return {
    id,
    title,
    model,
    message_count,
    revision,
    created_at,
    updated_at,
  }
}

/** Main state management hook for the server-backed playground. */
export function usePlaygroundState() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.auth.user?.id)

  const [config, setConfig] = useState<PlaygroundConfig>(
    getInitialPlaygroundConfig
  )
  const [parameterEnabled, setParameterEnabled] = useState<ParameterEnabled>(
    getInitialParameterEnabled
  )
  const [messages, setMessages] = useState<Message[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [activeSession, setActiveSession] =
    useState<PlaygroundSessionDetail | null>(null)
  const [isLoadingMessages, setIsLoadingMessages] = useState(true)
  const [isSessionBusy, setIsSessionBusy] = useState(false)
  const [sessionSaveStatus, setSessionSaveStatus] =
    useState<SessionSaveStatus>('saved')

  const configRef = useRef(config)
  const parameterEnabledRef = useRef(parameterEnabled)
  const messagesRef = useRef(messages)
  const activeSessionRef = useRef(activeSession)
  const activeUserIdRef = useRef(userId)
  const initializedUserRef = useRef<number | null>(null)
  const sessionRequestRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const saveEpochRef = useRef(0)
  const saveSequenceRef = useRef(0)
  const savedSequenceRef = useRef(0)
  const saveInFlightRef = useRef<InFlightSessionSave | null>(null)
  const latestSnapshotRef = useRef<SessionSnapshot | null>(null)
  const flushSessionSaveRef = useRef<
    (options?: SessionSaveOptions) => Promise<boolean>
  >(async () => true)

  activeUserIdRef.current = userId

  const sessionsQuery = useQuery({
    queryKey: sessionListQueryKey(userId),
    queryFn: listPlaygroundSessions,
    enabled: userId != null,
    retry: false,
  })

  const updateSessionCaches = useCallback(
    (session: PlaygroundSessionDetail) => {
      queryClient.setQueryData(
        sessionDetailQueryKey(userId, session.id),
        session
      )
      queryClient.setQueryData<PlaygroundSessionSummary[]>(
        sessionListQueryKey(userId),
        (current = []) => {
          const summary = toSessionSummary(session)
          const next = current.filter((item) => item.id !== session.id)
          return [summary, ...next].sort(
            (left, right) => right.updated_at - left.updated_at
          )
        }
      )
    },
    [queryClient, userId]
  )

  const invalidateSessionSaves = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveEpochRef.current += 1
    saveSequenceRef.current = 0
    savedSequenceRef.current = 0
    saveInFlightRef.current = null
    latestSnapshotRef.current = null
  }, [])

  const hydrateSession = useCallback(
    (session: PlaygroundSessionDetail) => {
      invalidateSessionSaves()
      const sanitizedMessages = sanitizeMessagesForPersistence(
        session.messages ?? []
      )
      const nextConfig = {
        ...DEFAULT_CONFIG,
        ...session.config,
        comparison: {
          ...DEFAULT_CONFIG.comparison,
          ...session.config.comparison,
        },
      }
      const nextParameterEnabled = {
        ...DEFAULT_PARAMETER_ENABLED,
        ...session.parameter_enabled,
      }
      const normalized = { ...session, messages: sanitizedMessages }

      configRef.current = nextConfig
      parameterEnabledRef.current = nextParameterEnabled
      messagesRef.current = sanitizedMessages
      activeSessionRef.current = normalized
      latestSnapshotRef.current = {
        config: nextConfig,
        parameter_enabled: nextParameterEnabled,
        messages: sanitizedMessages,
      }
      setConfig(nextConfig)
      setParameterEnabled(nextParameterEnabled)
      setMessages(sanitizedMessages)
      setActiveSession(normalized)
      setSessionSaveStatus('saved')
      saveConfig(nextConfig)
      saveParameterEnabled(nextParameterEnabled)
      updateSessionCaches(normalized)
    },
    [invalidateSessionSaves, updateSessionCaches]
  )

  const flushSessionSave = useCallback(
    async (options: SessionSaveOptions = {}) => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      const epoch = saveEpochRef.current
      const saveUserId = activeUserIdRef.current
      while (
        epoch === saveEpochRef.current &&
        savedSequenceRef.current < saveSequenceRef.current
      ) {
        const existingSave = saveInFlightRef.current
        if (existingSave?.epoch === epoch) {
          try {
            await existingSave.request
          } catch {
            return false
          }
          if (epoch !== saveEpochRef.current) return false
          continue
        }

        const session = activeSessionRef.current
        const snapshot = latestSnapshotRef.current
        if (!session || !snapshot) return false

        const targetSequence = saveSequenceRef.current
        setSessionSaveStatus('saving')
        const request = updatePlaygroundSession(
          session.id,
          {
            revision: session.revision,
            config: snapshot.config,
            parameter_enabled: snapshot.parameter_enabled,
            messages: sanitizeMessagesForPersistence(snapshot.messages),
          },
          options
        )
        const inFlightSave = { epoch, sessionId: session.id, request }
        saveInFlightRef.current = inFlightSave

        const isCurrentSave = () =>
          epoch === saveEpochRef.current &&
          saveUserId === activeUserIdRef.current &&
          activeSessionRef.current?.id === session.id

        try {
          const updated = await request
          if (!isCurrentSave()) return false
          savedSequenceRef.current = targetSequence
          activeSessionRef.current = updated
          setActiveSession(updated)
          updateSessionCaches(updated)
          if (savedSequenceRef.current === saveSequenceRef.current) {
            setSessionSaveStatus('saved')
          }
        } catch (error) {
          if (!isCurrentSave()) return false
          if (getServerErrorStatus(error) === 409) {
            try {
              const latest = await getPlaygroundSession(session.id)
              if (!isCurrentSave()) return false
              hydrateSession(latest)
              toast.error(
                t(
                  'This chat changed in another tab. The latest version was loaded.'
                )
              )
            } catch (reloadError) {
              setSessionSaveStatus('error')
              handleServerError(reloadError)
            }
          } else {
            setSessionSaveStatus('error')
            handleServerError(error, t('Failed to save chat'))
          }
          return false
        } finally {
          if (saveInFlightRef.current === inFlightSave) {
            saveInFlightRef.current = null
          }
        }
      }

      return epoch === saveEpochRef.current
    },
    [hydrateSession, t, updateSessionCaches]
  )

  useEffect(() => {
    flushSessionSaveRef.current = flushSessionSave
  }, [flushSessionSave])

  const queueSessionSave = useCallback(() => {
    if (!activeSessionRef.current) return
    latestSnapshotRef.current = {
      config: configRef.current,
      parameter_enabled: parameterEnabledRef.current,
      messages: messagesRef.current,
    }
    saveSequenceRef.current += 1
    setSessionSaveStatus('saving')

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSessionSave()
    }, SESSION_SAVE_DEBOUNCE_MS)
  }, [flushSessionSave])

  const fetchAndHydrateSession = useCallback(
    async (sessionId: string) => {
      const requestId = ++sessionRequestRef.current
      const requestUserId = userId
      setIsLoadingMessages(true)
      try {
        const session = await queryClient.fetchQuery({
          queryKey: sessionDetailQueryKey(userId, sessionId),
          queryFn: () => getPlaygroundSession(sessionId),
          staleTime: 0,
        })
        if (
          requestId === sessionRequestRef.current &&
          requestUserId === activeUserIdRef.current
        ) {
          hydrateSession(session)
        }
        return true
      } catch (error) {
        if (
          requestId === sessionRequestRef.current &&
          requestUserId === activeUserIdRef.current
        ) {
          handleServerError(error, t('Unable to load chat'))
        }
        return false
      } finally {
        if (
          requestId === sessionRequestRef.current &&
          requestUserId === activeUserIdRef.current
        ) {
          setIsLoadingMessages(false)
        }
      }
    },
    [hydrateSession, queryClient, t, userId]
  )

  useEffect(() => {
    invalidateSessionSaves()
    initializedUserRef.current = null
    sessionRequestRef.current += 1
    activeSessionRef.current = null
    setActiveSession(null)
    setMessages([])
    messagesRef.current = []
    setSessionSaveStatus('saved')
    setIsLoadingMessages(true)
  }, [invalidateSessionSaves, userId])

  useEffect(() => {
    if (
      userId == null ||
      !sessionsQuery.isSuccess ||
      initializedUserRef.current === userId
    ) {
      return
    }

    let cancelled = false
    initializedUserRef.current = userId

    const initialize = async () => {
      try {
        const existing = sessionsQuery.data ?? []
        if (existing.length > 0) {
          const loaded = await fetchAndHydrateSession(existing[0].id)
          if (!loaded) throw new Error('Unable to load playground session')
        } else {
          const legacyMessages = loadMessages()
          const sanitizedLegacy = sanitizeMessagesForPersistence(
            legacyMessages ?? []
          )
          const firstUserContent = sanitizedLegacy
            .find((message) => message.from === 'user')
            ?.versions.at(-1)
            ?.content.trim()
          const created = await createPlaygroundSession({
            ...(firstUserContent
              ? { title: firstUserContent.replaceAll(/\s+/g, ' ').slice(0, 80) }
              : {}),
            config: configRef.current,
            parameter_enabled: parameterEnabledRef.current,
            messages: sanitizedLegacy,
          })
          if (!cancelled) {
            clearStoredMessages()
            hydrateSession(created)
            setIsLoadingMessages(false)
          }
        }
        if (!cancelled) initializedUserRef.current = userId
      } catch (error) {
        if (!cancelled) {
          initializedUserRef.current = null
          setIsLoadingMessages(false)
          handleServerError(error, t('Unable to load chats'))
        }
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [
    fetchAndHydrateSession,
    hydrateSession,
    sessionsQuery.data,
    sessionsQuery.isSuccess,
    t,
    userId,
  ])

  useEffect(() => {
    const flushBeforePageExit = () => {
      if (savedSequenceRef.current < saveSequenceRef.current) {
        void flushSessionSaveRef.current({ keepalive: true })
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBeforePageExit()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', flushBeforePageExit)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', flushBeforePageExit)
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      flushBeforePageExit()
    }
  }, [])

  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      const updated = { ...configRef.current, [key]: value }
      configRef.current = updated
      setConfig(updated)
      saveConfig(updated)
      queueSessionSave()
    },
    [queueSessionSave]
  )

  const updateParameterEnabled = useCallback(
    (key: keyof ParameterEnabled, value: boolean) => {
      const updated = { ...parameterEnabledRef.current, [key]: value }
      parameterEnabledRef.current = updated
      setParameterEnabled(updated)
      saveParameterEnabled(updated)
      queueSessionSave()
    },
    [queueSessionSave]
  )

  const updateMessages = useCallback(
    (updater: MessageStateUpdater) => {
      const updated = applyMessageStateUpdate(messagesRef.current, updater)
      messagesRef.current = updated
      setMessages(updated)
      queueSessionSave()
    },
    [queueSessionSave]
  )

  const clearMessages = useCallback(() => updateMessages([]), [updateMessages])

  const resetConfig = useCallback(() => {
    configRef.current = DEFAULT_CONFIG
    parameterEnabledRef.current = DEFAULT_PARAMETER_ENABLED
    setConfig(DEFAULT_CONFIG)
    setParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    saveConfig(DEFAULT_CONFIG)
    saveParameterEnabled(DEFAULT_PARAMETER_ENABLED)
    queueSessionSave()
  }, [queueSessionSave])

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (activeSessionRef.current?.id === sessionId || isSessionBusy) return
      setIsSessionBusy(true)
      try {
        const saved = await flushSessionSave()
        if (!saved) return
        await fetchAndHydrateSession(sessionId)
      } finally {
        setIsSessionBusy(false)
      }
    },
    [fetchAndHydrateSession, flushSessionSave, isSessionBusy]
  )

  const createSession = useCallback(async () => {
    if (isSessionBusy) return
    setIsSessionBusy(true)
    try {
      const saved = await flushSessionSave()
      if (!saved) return
      const created = await createPlaygroundSession({
        config: configRef.current,
        parameter_enabled: parameterEnabledRef.current,
        messages: [],
      })
      hydrateSession(created)
      setIsLoadingMessages(false)
    } catch (error) {
      handleServerError(error, t('Failed to create chat'))
    } finally {
      setIsSessionBusy(false)
    }
  }, [flushSessionSave, hydrateSession, isSessionBusy, t])

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const current =
        activeSessionRef.current?.id === sessionId
          ? activeSessionRef.current
          : sessionsQuery.data?.find((session) => session.id === sessionId)
      if (!current) return false

      setIsSessionBusy(true)
      try {
        if (activeSessionRef.current?.id === sessionId) {
          const saved = await flushSessionSave()
          if (!saved) return false
        }
        const latest =
          activeSessionRef.current?.id === sessionId
            ? activeSessionRef.current
            : current
        const updated = await updatePlaygroundSession(sessionId, {
          revision: latest.revision,
          title: title.trim(),
        })
        if (activeSessionRef.current?.id === sessionId) {
          activeSessionRef.current = updated
          setActiveSession(updated)
        }
        updateSessionCaches(updated)
        return true
      } catch (error) {
        handleServerError(error, t('Rename failed'))
        return false
      } finally {
        setIsSessionBusy(false)
      }
    },
    [flushSessionSave, sessionsQuery.data, t, updateSessionCaches]
  )

  const removeSession = useCallback(
    async (sessionId: string) => {
      setIsSessionBusy(true)
      const removingActiveSession = activeSessionRef.current?.id === sessionId
      try {
        if (removingActiveSession) invalidateSessionSaves()
        await deletePlaygroundSession(sessionId)
        queryClient.removeQueries({
          queryKey: sessionDetailQueryKey(userId, sessionId),
          exact: true,
        })
        const remaining = (sessionsQuery.data ?? []).filter(
          (session) => session.id !== sessionId
        )
        queryClient.setQueryData(sessionListQueryKey(userId), remaining)

        if (activeSessionRef.current?.id === sessionId) {
          if (remaining.length > 0) {
            await fetchAndHydrateSession(remaining[0].id)
          } else {
            const created = await createPlaygroundSession({
              config: configRef.current,
              parameter_enabled: parameterEnabledRef.current,
              messages: [],
            })
            hydrateSession(created)
            setIsLoadingMessages(false)
          }
        }
        return true
      } catch (error) {
        if (
          removingActiveSession &&
          activeSessionRef.current?.id === sessionId
        ) {
          latestSnapshotRef.current = {
            config: configRef.current,
            parameter_enabled: parameterEnabledRef.current,
            messages: messagesRef.current,
          }
          queueSessionSave()
        }
        handleServerError(error, t('Failed to delete chat'))
        return false
      } finally {
        setIsSessionBusy(false)
      }
    },
    [
      fetchAndHydrateSession,
      hydrateSession,
      invalidateSessionSaves,
      queryClient,
      queueSessionSave,
      sessionsQuery.data,
      t,
      userId,
    ]
  )

  return {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    sessions: sessionsQuery.data ?? [],
    activeSessionId: activeSession?.id ?? null,
    isLoadingSessions: sessionsQuery.isLoading,
    isSessionsError: sessionsQuery.isError,
    isSessionBusy,
    sessionSaveStatus,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    updateMessages,
    clearMessages,
    resetConfig,
    selectSession,
    createSession,
    renameSession,
    removeSession,
    retrySessions: sessionsQuery.refetch,
  }
}
