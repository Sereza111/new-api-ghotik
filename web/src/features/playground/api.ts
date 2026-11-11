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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ModelOption,
  GroupOption,
  PlaygroundSessionDetail,
  PlaygroundSessionInput,
  PlaygroundSessionSummary,
  PlaygroundSessionUpdate,
} from './types'

interface PlaygroundSessionResponse<T> {
  success: boolean
  message?: string
  code?: string
  data?: T
}

const KEEPALIVE_REQUEST_MAX_BYTES = 60 * 1024
const textEncoder = new TextEncoder()

type PlaygroundSessionUpdateOptions = {
  keepalive?: boolean
}

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

export async function sendImageGeneration(
  payload: ImageGenerationRequest,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  const endpoint = payload.images?.length
    ? API_ENDPOINTS.IMAGE_EDITS
    : API_ENDPOINTS.IMAGE_GENERATIONS
  const res = await api.post(endpoint, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res
  requireServerSuccess(data)

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<
    string,
    { desc: string; ratio: number | string }
  >

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export async function listPlaygroundSessions(): Promise<
  PlaygroundSessionSummary[]
> {
  const res = await api.get(API_ENDPOINTS.PLAYGROUND_SESSIONS)
  const response = requireServerSuccess(
    res.data as PlaygroundSessionResponse<PlaygroundSessionSummary[]>
  )
  return response.data ?? []
}

export async function getPlaygroundSession(
  id: string
): Promise<PlaygroundSessionDetail> {
  const res = await api.get(`${API_ENDPOINTS.PLAYGROUND_SESSIONS}/${id}`)
  const response = requireServerSuccess(
    res.data as PlaygroundSessionResponse<PlaygroundSessionDetail>
  )
  if (!response.data) throw new Error('Playground session not found')
  return response.data
}

export async function createPlaygroundSession(
  input: PlaygroundSessionInput
): Promise<PlaygroundSessionDetail> {
  const res = await api.post(API_ENDPOINTS.PLAYGROUND_SESSIONS, input)
  const response = requireServerSuccess(
    res.data as PlaygroundSessionResponse<PlaygroundSessionDetail>
  )
  if (!response.data) throw new Error('Playground session was not created')
  return response.data
}

export async function updatePlaygroundSession(
  id: string,
  input: PlaygroundSessionUpdate,
  options: PlaygroundSessionUpdateOptions = {}
): Promise<PlaygroundSessionDetail> {
  const useKeepalive =
    options.keepalive === true &&
    textEncoder.encode(JSON.stringify(input)).byteLength <=
      KEEPALIVE_REQUEST_MAX_BYTES
  const res = await api.put(
    `${API_ENDPOINTS.PLAYGROUND_SESSIONS}/${id}`,
    input,
    {
      skipErrorHandler: true,
      ...(useKeepalive
        ? { adapter: 'fetch', fetchOptions: { keepalive: true } }
        : {}),
    }
  )
  const response = requireServerSuccess(
    res.data as PlaygroundSessionResponse<PlaygroundSessionDetail>
  )
  if (!response.data) throw new Error('Playground session was not updated')
  return response.data
}

export async function deletePlaygroundSession(id: string): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.PLAYGROUND_SESSIONS}/${id}`)
  requireServerSuccess(res.data as PlaygroundSessionResponse<null>)
}
