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

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import { applyImageGenerationResponse } from '../message/message-streaming-utils'
import {
  createLoadingAssistantMessage,
  createUserMessage,
} from '../message/message-utils'
import { getReasoningEffortOptions } from '../parameters/model-capabilities'
import {
  buildChatCompletionPayload,
  buildImageGenerationPayload,
  isImageGenerationModel,
} from './payload-builder'

describe('image generation payload', () => {
  it('recognizes OpenAI image generation models', () => {
    expect(isImageGenerationModel('gpt-image-2')).toBe(true)
    expect(isImageGenerationModel('gpt-image-2.6-sunburst')).toBe(true)
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

  it('includes pasted references in image edit payloads', () => {
    const reference = 'data:image/png;base64,aW1hZ2U='
    const messages = [
      createUserMessage('keep the subject and change the background', 1_000, [
        reference,
      ]),
      createLoadingAssistantMessage(),
    ]

    expect(
      buildImageGenerationPayload(messages, {
        ...DEFAULT_CONFIG,
        model: 'gpt-image-2.5-sunburst',
        group: 'GPT',
      })
    ).toEqual({
      model: 'gpt-image-2.5-sunburst',
      group: 'GPT',
      prompt: 'keep the subject and change the background',
      n: 1,
      quality: 'medium',
      size: '1024x1024',
      images: [{ image_url: reference }],
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
        format: 'png',
        revisedPrompt: 'A winter forest',
      },
    ])
  })

  it.each([
    {
      name: 'GIF',
      base64: 'R0lGODlh',
      reportedFormat: 'gif',
      expectedFormat: 'gif',
      expectedMime: 'image/gif',
    },
    {
      name: 'SVG',
      base64:
        'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
      reportedFormat: 'svg',
      expectedFormat: 'svg',
      expectedMime: 'image/svg+xml',
    },
    {
      name: 'actual PNG despite reported SVG',
      base64: 'iVBORw0KGgo=',
      reportedFormat: 'svg',
      expectedFormat: 'png',
      expectedMime: 'image/png',
    },
  ])('uses the actual $name response format for previews', (testCase) => {
    const message = applyImageGenerationResponse(
      createLoadingAssistantMessage(1_000),
      {
        output_format: testCase.reportedFormat,
        data: [{ b64_json: testCase.base64 }],
      }
    )

    expect(message?.images?.[0]?.format).toBe(testCase.expectedFormat)
    expect(message?.images?.[0]?.src).toBe(
      `data:${testCase.expectedMime};base64,${testCase.base64}`
    )
  })
})

describe('chat completion payload', () => {
  it('sends explicit disabled reasoning for Claude instead of inheriting provider defaults', () => {
    expect(
      buildChatCompletionPayload(
        [createUserMessage('hello')],
        {
          ...DEFAULT_CONFIG,
          model: 'claude-opus-4-6',
          reasoning_effort: 'none',
        },
        DEFAULT_PARAMETER_ENABLED
      ).reasoning_effort
    ).toBe('none')
  })

  it('only offers effort levels supported by the selected model', () => {
    expect(getReasoningEffortOptions('claude-opus-4-6')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'max',
    ])
    expect(getReasoningEffortOptions('gemini-3-pro-preview')).toEqual([
      'low',
      'high',
    ])
    expect(getReasoningEffortOptions('gpt-4o')).toEqual(['none'])
    expect(getReasoningEffortOptions('gpt-6-astra')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(getReasoningEffortOptions('gpt-6.1-sol')).not.toContain('none')
    expect(getReasoningEffortOptions('gpt-6-sol')).not.toContain('minimal')
  })
  it('sends pasted references as multimodal message content', () => {
    const reference = 'data:image/webp;base64,aW1hZ2U='
    const payload = buildChatCompletionPayload(
      [createUserMessage('describe this image', 1_000, [reference])],
      DEFAULT_CONFIG,
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe this image' },
          { type: 'image_url', image_url: { url: reference } },
        ],
      },
    ])
  })

  it('sends uploaded documents as OpenAI-compatible file parts', () => {
    const document = 'data:application/pdf;base64,JVBERi0xLjQKcGxheWdyb3VuZA=='
    const payload = buildChatCompletionPayload(
      [
        createUserMessage(
          'Summarize the report',
          1_000,
          [],
          [{ id: 'report', filename: 'report.pdf', dataUrl: document }]
        ),
      ],
      DEFAULT_CONFIG,
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize the report' },
          {
            type: 'file',
            file: {
              filename: 'report.pdf',
              file_data: document,
            },
          },
        ],
      },
    ])
  })

  it('allows a document-only user message', () => {
    const document = 'data:application/octet-stream;base64,aGVsbG8='
    const payload = buildChatCompletionPayload(
      [
        createUserMessage(
          '',
          1_000,
          [],
          [{ id: 'notes', filename: 'notes.txt', dataUrl: document }]
        ),
      ],
      DEFAULT_CONFIG,
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          file: {
            filename: 'notes.txt',
            file_data: 'data:text/plain;base64,aGVsbG8=',
          },
        },
      ],
    })
  })

  it('normalizes a DOCX browser MIME to the canonical document type', () => {
    const payload = buildChatCompletionPayload(
      [
        createUserMessage(
          'Read this document',
          1_000,
          [],
          [
            {
              id: 'word-document',
              filename: 'report.docx',
              dataUrl: 'data:application/zip;base64,UEsDBA==',
            },
          ]
        ),
      ],
      DEFAULT_CONFIG,
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Read this document' },
        {
          type: 'file',
          file: {
            filename: 'report.docx',
            file_data:
              'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==',
          },
        },
      ],
    })
  })

  it('preserves the selected reasoning effort', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('solve this carefully')],
      { ...DEFAULT_CONFIG, model: 'claude-opus-4-6', reasoning_effort: 'high' },
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.reasoning_effort).toBe('high')
  })

  it('sends Ultra as the canonical max reasoning effort', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('solve this exhaustively')],
      {
        ...DEFAULT_CONFIG,
        model: 'gpt-6-sol',
        reasoning_effort: 'max',
      },
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.reasoning_effort).toBe('max')
  })

  it('omits effort for models without configurable reasoning', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('solve this carefully')],
      {
        ...DEFAULT_CONFIG,
        model: 'gpt-4o',
        reasoning_effort: 'max',
      },
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.reasoning_effort).toBeUndefined()
  })

  it('leaves hosted web search selection to the provider aware server', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('find the latest release')],
      { ...DEFAULT_CONFIG, web_search_enabled: true },
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload.web_search_options).toBeUndefined()
  })

  it('omits parameters that conflict with OpenAI reasoning models', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('solve this')],
      {
        ...DEFAULT_CONFIG,
        model: 'gpt-6-sol',
        reasoning_effort: 'max',
        temperature: 0,
        top_p: 0,
        max_tokens: 8192,
        frequency_penalty: 0,
        presence_penalty: 0,
        seed: 0,
      },
      {
        temperature: true,
        top_p: true,
        max_tokens: true,
        frequency_penalty: true,
        presence_penalty: true,
        seed: true,
      }
    )

    expect(payload).toMatchObject({
      reasoning_effort: 'max',
      max_tokens: 8192,
    })
    expect(payload).not.toHaveProperty('temperature')
    expect(payload).not.toHaveProperty('top_p')
    expect(payload).not.toHaveProperty('frequency_penalty')
    expect(payload).not.toHaveProperty('presence_penalty')
    expect(payload).not.toHaveProperty('seed')
  })

  it('preserves explicit zero values for compatible models', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('answer this')],
      {
        ...DEFAULT_CONFIG,
        model: 'gpt-4o',
        temperature: 0,
        top_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        seed: 0,
      },
      {
        temperature: true,
        top_p: true,
        max_tokens: false,
        frequency_penalty: true,
        presence_penalty: true,
        seed: true,
      }
    )

    expect(payload).toMatchObject({
      temperature: 0,
      top_p: 0,
      frequency_penalty: 0,
      presence_penalty: 0,
      seed: 0,
    })
  })

  it('omits reasoning effort when it is disabled', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('answer normally')],
      DEFAULT_CONFIG,
      {
        temperature: false,
        top_p: false,
        max_tokens: false,
        frequency_penalty: false,
        presence_penalty: false,
        seed: false,
      }
    )

    expect(payload).not.toHaveProperty('reasoning_effort')
  })
})
