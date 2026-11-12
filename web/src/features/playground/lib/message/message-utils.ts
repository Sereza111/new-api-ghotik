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
import { nanoid } from 'nanoid'

import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type {
  Message,
  MessageVersion,
  ChatCompletionMessage,
  ContentPart,
  InputFileAttachment,
} from '../../types'

const ATTACHMENT_MIME_BY_EXTENSION: Record<string, string> = {
  '.csv': 'text/csv',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
  '.markdown': 'text/markdown',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
}

function normalizeAttachmentDataUrl(file: InputFileAttachment): string {
  const dataUrl = file.dataUrl.trim()
  if (!dataUrl.startsWith('data:')) return dataUrl

  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) return dataUrl

  const metadata = dataUrl.slice(5, commaIndex)
  const separatorIndex = metadata.indexOf(';')
  const declaredMime = (
    separatorIndex === -1 ? metadata : metadata.slice(0, separatorIndex)
  )
    .trim()
    .toLowerCase()

  const filename = file.filename.trim().toLowerCase()
  const extension = Object.keys(ATTACHMENT_MIME_BY_EXTENSION).find((value) =>
    filename.endsWith(value)
  )
  if (!extension) return dataUrl

  const canonicalMime = ATTACHMENT_MIME_BY_EXTENSION[extension]
  if (declaredMime === canonicalMime) return dataUrl

  const parameters = separatorIndex === -1 ? '' : metadata.slice(separatorIndex)
  return `data:${canonicalMime}${parameters}${dataUrl.slice(commaIndex)}`
}

/**
 * Create a new message version
 */
export function createMessageVersion(content: string): MessageVersion {
  return {
    id: nanoid(),
    content,
  }
}

/**
 * Get current version from message (always returns the first version)
 */
export function getCurrentVersion(message: Message): MessageVersion {
  return message.versions[0] || { id: 'default', content: '' }
}

/**
 * Get displayable content from the current message version.
 */
export function getMessageContent(message: Message): string {
  return getCurrentVersion(message).content
}

/**
 * Check whether a message has non-empty content in its current version.
 */
export function hasMessageContent(message: Message): boolean {
  return getMessageContent(message).trim() !== ''
}

/**
 * Update current version content in message
 */
export function updateCurrentVersionContent(
  message: Message,
  content: string
): Message {
  const currentVersion = getCurrentVersion(message)
  return {
    ...message,
    versions: [{ ...currentVersion, content }],
  }
}

/**
 * Create a user message
 */
export function createUserMessage(
  content: string,
  createdAt: number = Date.now(),
  inputImages: string[] = [],
  inputFiles: InputFileAttachment[] = []
): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.USER,
    versions: [createMessageVersion(content)],
    createdAt,
    inputImages: inputImages.length > 0 ? inputImages : undefined,
    inputFiles: inputFiles.length > 0 ? inputFiles : undefined,
  }
}

/**
 * Create a loading assistant message
 */
export function createLoadingAssistantMessage(
  startedAt: number = Date.now()
): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.ASSISTANT,
    versions: [createMessageVersion('')],
    createdAt: startedAt,
    startedAt,
    reasoning: undefined,
    isReasoningComplete: false,
    isContentComplete: false,
    isReasoningStreaming: false,
    status: MESSAGE_STATUS.LOADING,
  }
}

/**
 * Build message content with optional images and files.
 */
export function buildMessageContent(
  text: string,
  imageUrls: string[] = [],
  inputFiles: InputFileAttachment[] = []
): string | ContentPart[] {
  const validImages = imageUrls.filter((url) => url.trim() !== '')
  const validFiles = inputFiles.filter(
    (file) => file.filename.trim() !== '' && file.dataUrl.trim() !== ''
  )

  if (validImages.length === 0 && validFiles.length === 0) {
    return text
  }

  const parts: ContentPart[] = [
    ...(text.trim() ? [{ type: 'text' as const, text }] : []),
    ...validImages.map((url) => ({
      type: 'image_url' as const,
      image_url: { url: url.trim() },
    })),
    ...validFiles.map((file) => ({
      type: 'file' as const,
      file: {
        filename: file.filename.trim(),
        file_data: normalizeAttachmentDataUrl(file),
      },
    })),
  ]

  return parts
}

/**
 * Extract text content from message content
 */
export function getTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === 'text')
    return textPart?.text || ''
  }

  return ''
}

/**
 * Format message for API request
 */
export function formatMessageForAPI(message: Message): ChatCompletionMessage {
  const currentVersion = getCurrentVersion(message)
  return {
    role: message.from,
    content: buildMessageContent(
      currentVersion.content,
      message.inputImages,
      message.inputFiles
    ),
  }
}

/**
 * Check if message is valid for API request
 * Excludes loading/streaming assistant messages and empty content
 */
export function isValidMessage(message: Message): boolean {
  if (!message || !message.from || !message.versions.length) return false

  // Exclude empty assistant messages (loading/streaming placeholders)
  if (message.from === MESSAGE_ROLES.ASSISTANT && !hasMessageContent(message)) {
    return false
  }

  return true
}
