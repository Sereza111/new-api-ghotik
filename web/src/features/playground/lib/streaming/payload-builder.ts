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
import type {
  ChatCompletionRequest,
  ImageGenerationRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../../types'
import {
  formatMessageForAPI,
  getMessageContent,
  isValidMessage,
} from '../message/message-utils'

const IMAGE_MODEL_PATTERNS = [
  /^gpt-image-/i,
  /^chatgpt-image-/i,
  /^dall-e(?:-|$)/i,
]

export function isImageGenerationModel(model: string): boolean {
  return IMAGE_MODEL_PATTERNS.some((pattern) => pattern.test(model.trim()))
}

export function buildImageGenerationPayload(
  messages: Message[],
  config: PlaygroundConfig
): ImageGenerationRequest {
  let prompt = ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.from === 'user' && isValidMessage(message)) {
      prompt = getMessageContent(message)
      break
    }
  }

  return {
    model: config.model,
    group: config.group,
    prompt,
    n: 1,
    quality: 'medium',
    size: '1024x1024',
  }
}

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled
): ChatCompletionRequest {
  // Filter and format valid messages
  const processedMessages = messages
    .filter(isValidMessage)
    .map(formatMessageForAPI)

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  if (parameterEnabled.temperature) {
    payload.temperature = config.temperature
  }

  if (parameterEnabled.top_p) {
    payload.top_p = config.top_p
  }

  if (parameterEnabled.max_tokens) {
    payload.max_tokens = config.max_tokens
  }

  if (parameterEnabled.frequency_penalty) {
    payload.frequency_penalty = config.frequency_penalty
  }

  if (parameterEnabled.presence_penalty) {
    payload.presence_penalty = config.presence_penalty
  }

  if (parameterEnabled.seed && config.seed !== null) {
    payload.seed = config.seed
  }

  if (config.reasoning_effort !== 'none') {
    payload.reasoning_effort = config.reasoning_effort
  }

  return payload
}
