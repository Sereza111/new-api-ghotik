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
import { t } from 'i18next'

import { ERROR_MESSAGES, MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type {
  ChatCompletionResponse,
  GeneratedImage,
  ImageGenerationResponse,
  Message,
} from '../../types'
import { parseThinkTags } from './message-reasoning-utils'
import {
  completeAssistantTiming,
  completeReasoningTiming,
  startReasoningTiming,
} from './message-timing-utils'
import {
  getCurrentVersion,
  hasMessageContent,
  updateCurrentVersionContent,
} from './message-utils'

/**
 * Process content chunk during streaming.
 * Separates <think> reasoning from visible content in real-time.
 * Note: versions[0].content keeps the full raw content with tags during streaming.
 */
export function processStreamingContent(
  message: Message,
  contentChunk?: string
): Message {
  const currentVersion = getCurrentVersion(message)
  const fullContent = contentChunk
    ? currentVersion.content + contentChunk
    : currentVersion.content

  if (!message.reasoning && !fullContent.includes('<think>')) {
    return {
      ...updateCurrentVersionContent(message, fullContent),
      isReasoningStreaming: false,
    }
  }

  const { reasoning, hasUnclosedTag } = parseThinkTags(fullContent)
  const finalReasoning = reasoning
    ? {
        ...startReasoningTiming(message),
        content: reasoning,
      }
    : message.reasoning

  return {
    ...updateCurrentVersionContent(message, fullContent),
    reasoning: finalReasoning,
    isReasoningStreaming: hasUnclosedTag,
  }
}

export type StreamChunkType = 'reasoning' | 'content'

function getAppendableChunk(currentContent: string, chunk: string): string {
  if (!currentContent || !chunk.startsWith(currentContent)) {
    return chunk
  }

  return chunk.slice(currentContent.length)
}

export function applyStreamingChunk(
  message: Message,
  type: StreamChunkType,
  chunk: string
): Message {
  if (message.status === MESSAGE_STATUS.ERROR) {
    return message
  }

  if (type === 'reasoning') {
    const reasoning = startReasoningTiming(message)
    const appendableChunk = getAppendableChunk(reasoning.content, chunk)

    return {
      ...message,
      reasoning: {
        ...reasoning,
        content: reasoning.content + appendableChunk,
      },
      isReasoningStreaming: true,
      status: MESSAGE_STATUS.STREAMING,
    }
  }

  const currentVersion = getCurrentVersion(message)
  const appendableChunk = getAppendableChunk(currentVersion.content, chunk)
  const contentMessage = processStreamingContent(message, appendableChunk)

  return {
    ...(contentMessage.isReasoningStreaming
      ? contentMessage
      : completeReasoningTiming(contentMessage)),
    status: MESSAGE_STATUS.STREAMING,
  }
}

/**
 * Finalize message after streaming completes.
 * Cleans content and consolidates reasoning from all sources.
 */
export function finalizeMessage(
  message: Message,
  apiReasoningContent?: string | null
): Message {
  const currentVersion = getCurrentVersion(message)
  const parsedThinkTags = currentVersion.content.includes('<think>')
    ? parseThinkTags(currentVersion.content)
    : undefined
  const visibleContent =
    parsedThinkTags?.visibleContent ?? currentVersion.content
  const finalReasoning =
    apiReasoningContent ||
    message.reasoning?.content ||
    parsedThinkTags?.reasoning ||
    ''

  const finalized = {
    ...updateCurrentVersionContent(message, visibleContent),
    reasoning: finalReasoning
      ? {
          ...startReasoningTiming(message),
          content: finalReasoning,
        }
      : undefined,
    isReasoningStreaming: false,
  }

  return completeReasoningTiming(finalized)
}

export function completeAssistantMessage(message: Message): Message {
  return completeAssistantTiming({
    ...finalizeMessage(message),
    status: MESSAGE_STATUS.COMPLETE,
  })
}

export function isAssistantMessageFinal(message: Message): boolean {
  return (
    message.status === MESSAGE_STATUS.COMPLETE ||
    message.status === MESSAGE_STATUS.ERROR
  )
}

export function isAssistantMessagePending(message: Message): boolean {
  return (
    message.status === MESSAGE_STATUS.LOADING ||
    message.status === MESSAGE_STATUS.STREAMING
  )
}

export function isPendingAssistantMessage(message?: Message): boolean {
  return Boolean(
    message?.from === MESSAGE_ROLES.ASSISTANT &&
    isAssistantMessagePending(message)
  )
}

type ChatCompletionChoice = ChatCompletionResponse['choices'][number]

export function hasChatCompletionChoice(
  response: ChatCompletionResponse
): boolean {
  return Boolean(response.choices?.[0])
}

export function applyChatCompletionChoice(
  message: Message,
  choice: ChatCompletionChoice
): Message {
  return completeAssistantTiming({
    ...finalizeMessage(
      updateCurrentVersionContent(message, choice.message?.content || ''),
      choice.message?.reasoning_content ?? choice.message?.reasoning
    ),
    status: MESSAGE_STATUS.COMPLETE,
  })
}

export function applyChatCompletionResponse(
  message: Message,
  response: ChatCompletionResponse
): Message | null {
  const choice = response.choices?.[0]

  if (!choice) {
    return null
  }

  return applyChatCompletionChoice(message, choice)
}

export function applyImageGenerationResponse(
  message: Message,
  response: ImageGenerationResponse
): Message | null {
  const images = response.data.flatMap((image, index) => {
    const format = resolveGeneratedImageFormat(
      image.b64_json,
      image.url,
      image.output_format || response.output_format
    )
    const src = image.b64_json
      ? `data:${imageFormatMimeType(format)};base64,${image.b64_json}`
      : image.url

    return src
      ? [
          {
            id: `${response.created ?? 'generated'}-${index}`,
            src,
            format,
            revisedPrompt: image.revised_prompt || undefined,
          },
        ]
      : []
  })

  if (images.length === 0) {
    return null
  }

  return completeAssistantTiming({
    ...finalizeMessage(message),
    images,
    status: MESSAGE_STATUS.COMPLETE,
  })
}

type GeneratedImageFormat = NonNullable<GeneratedImage['format']>

function normalizeGeneratedImageFormat(
  value?: string
): GeneratedImageFormat | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
      return 'jpeg'
    case 'webp':
      return 'webp'
    case 'gif':
      return 'gif'
    case 'svg':
    case 'svg+xml':
      return 'svg'
    default:
      return undefined
  }
}

function imageFormatMimeType(format: GeneratedImageFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg'
    case 'svg':
      return 'image/svg+xml'
    default:
      return `image/${format}`
  }
}

function formatFromDataUrl(url?: string): GeneratedImageFormat | undefined {
  if (!url?.startsWith('data:')) return undefined

  const mimeType = url.slice(5, url.indexOf(';')).toLowerCase()
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpeg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    default:
      return undefined
  }
}

function formatFromBase64Bytes(
  encoded?: string
): GeneratedImageFormat | undefined {
  if (!encoded) return undefined

  try {
    const normalized = encoded.replaceAll(/\s/g, '')
    const prefixLength = Math.min(normalized.length, 1368)
    const alignedLength = prefixLength - (prefixLength % 4)
    const decoded = atob(normalized.slice(0, alignedLength))
    const bytes = Uint8Array.from(decoded, (character) =>
      character.charCodeAt(0)
    )

    if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'png'
    }
    if (decoded.startsWith('GIF87a') || decoded.startsWith('GIF89a')) {
      return 'gif'
    }
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    ) {
      return 'jpeg'
    }
    if (decoded.startsWith('RIFF') && decoded.slice(8, 12) === 'WEBP') {
      return 'webp'
    }

    const textPrefix = new TextDecoder().decode(bytes)
    if (
      /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
        textPrefix
      )
    ) {
      return 'svg'
    }
  } catch {
    return undefined
  }

  return undefined
}

function resolveGeneratedImageFormat(
  base64?: string,
  url?: string,
  reportedFormat?: string
): GeneratedImageFormat {
  return (
    formatFromBase64Bytes(base64) ||
    formatFromDataUrl(url) ||
    normalizeGeneratedImageFormat(reportedFormat) ||
    'png'
  )
}

/**
 * Sanitize messages loaded from storage.
 * Converts stuck loading/streaming messages to stable state.
 */
export function sanitizeMessagesOnLoad(messages: Message[]): Message[] {
  let targetIndex = -1

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]

    if (isPendingAssistantMessage(message)) {
      targetIndex = i
      break
    }
  }

  if (targetIndex === -1) return messages

  const finalized = finalizeMessage(messages[targetIndex])
  const hasContent = hasMessageContent(finalized)
  const hasReasoning = finalized.reasoning?.content?.trim()

  const sanitized: Message =
    hasContent || hasReasoning
      ? completeAssistantTiming({
          ...finalized,
          status: MESSAGE_STATUS.COMPLETE,
          isReasoningStreaming: false,
        })
      : completeAssistantTiming({
          ...updateCurrentVersionContent(
            finalized,
            `${t(ERROR_MESSAGES.API_REQUEST_ERROR)}: ${t(
              ERROR_MESSAGES.INTERRUPTED
            )}`
          ),
          status: MESSAGE_STATUS.ERROR,
          isReasoningStreaming: false,
        })

  const result = [...messages]
  result[targetIndex] = sanitized
  return result
}
