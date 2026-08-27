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
import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG } from '../../constants'
import { applyImageGenerationResponse } from '../message/message-streaming-utils'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from '../message/message-utils'
import {
  buildImageGenerationPayload,
  isImageGenerationModel,
} from './payload-builder'

describe('image generation payload', () => {
  it('recognizes OpenAI image generation models', () => {
    expect(isImageGenerationModel('gpt-image-2')).toBe(true)
    expect(isImageGenerationModel('chatgpt-image-latest')).toBe(true)
    expect(isImageGenerationModel('gpt-5.6-terra')).toBe(false)
  })

  it('uses the latest user prompt and playground routing group', () => {
    const messages = [
      createUserMessage('first prompt'),
      createLoadingAssistantMessage(),
      createUserMessage('northern forest in winter'),
      createLoadingAssistantMessage(),
    ]

    expect(
      buildImageGenerationPayload(messages, {
        ...DEFAULT_CONFIG,
        model: 'gpt-image-2',
        group: 'GPT',
      })
    ).toEqual({
      model: 'gpt-image-2',
      group: 'GPT',
      prompt: 'northern forest in winter',
      n: 1,
      quality: 'medium',
      size: '1024x1024',
    })
  })

  it('turns a base64 API result into a displayable assistant image', () => {
    const message = applyImageGenerationResponse(
      createLoadingAssistantMessage(1_000),
      {
        data: [
          {
            b64_json: 'aW1hZ2U=',
            revised_prompt: 'A winter forest',
          },
        ],
      }
    )

    expect(message?.status).toBe('complete')
    expect(message?.images).toEqual([
      {
        id: 'generated-0',
        src: 'data:image/png;base64,aW1hZ2U=',
        revisedPrompt: 'A winter forest',
      },
    ])
  })
})
