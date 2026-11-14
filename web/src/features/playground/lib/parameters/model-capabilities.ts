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
import type { ReasoningEffort } from '../../types'
import type { PlaygroundParameterKey } from './playground-parameters'

const STANDARD_REASONING_LEVELS: ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
]

const EXTENDED_REASONING_LEVELS: ReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const OPENAI_REASONING_MODEL = /^(?:gpt-(?:5|6)|o[134](?:-|$))/i

export function getReasoningEffortOptions(model: string): ReasoningEffort[] {
  const name = model.trim().toLowerCase()
  if (/^claude-(?:fable-5|mythos-5|opus-5-5)/.test(name)) {
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (name.startsWith('claude-mythos-preview')) {
    return ['low', 'medium', 'high', 'max']
  }
  if (/^claude-(?:(?:opus|sonnet|haiku)-5|opus-4-[78])/.test(name)) {
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  }
  if (/^claude-(?:opus|sonnet)-4-6/.test(name)) {
    return ['none', 'low', 'medium', 'high', 'max']
  }
  if (/^claude-(?:3-7|(?:opus|sonnet|haiku)-4)/.test(name)) {
    return STANDARD_REASONING_LEVELS
  }
  if (/(?:image|tts|native-audio|live)/.test(name)) return ['none']
  if (name.startsWith('gemini-3-pro')) return ['low', 'high']
  if (/^gemini-3(?:\.[0-9]+)?-pro/.test(name) || name === 'gemini-pro-latest') {
    return ['low', 'medium', 'high']
  }
  if (
    name.startsWith('gemini-3') ||
    /^gemini-flash(?:-lite)?-latest$/.test(name)
  ) {
    return ['minimal', 'low', 'medium', 'high']
  }
  if (name.startsWith('gemini-2.5-pro')) return ['low', 'medium', 'high']
  if (name.startsWith('gemini-2.5-flash')) return STANDARD_REASONING_LEVELS
  if (/^o[134](?:-|$)/.test(name)) return ['low', 'medium', 'high']
  if (/^gpt-5(?:-|$)/.test(name) && !name.includes('search')) {
    return ['minimal', 'low', 'medium', 'high']
  }
  if (name.startsWith('gpt-5.1')) return STANDARD_REASONING_LEVELS
  if (name.startsWith('gpt-5.6')) return EXTENDED_REASONING_LEVELS
  if (/^gpt-5\.[2345](?:-|$)/.test(name)) {
    return ['none', 'low', 'medium', 'high', 'xhigh']
  }
  if (
    /^gpt-6(?:\.1)?-(?:astra|sol)/.test(name) &&
    !name.startsWith('gpt-6-sol')
  ) {
    return ['low', 'medium', 'high', 'xhigh', 'max']
  }
  if (/^gpt-6-(?:sol|luna)/.test(name)) return EXTENDED_REASONING_LEVELS
  return ['none']
}

export function normalizeReasoningEffort(
  model: string,
  effort: ReasoningEffort
): ReasoningEffort {
  const options = getReasoningEffortOptions(model)
  if (options.includes(effort)) return effort

  if (effort === 'none' || effort === 'minimal') return options[0]
  return options.includes('high') ? 'high' : options[0]
}

export function isParameterSupported(
  model: string,
  effort: ReasoningEffort,
  parameter: PlaygroundParameterKey
): boolean {
  const normalizedModel = model.trim().toLowerCase()
  const normalizedEffort = normalizeReasoningEffort(model, effort)
  const reasoningEnabled = normalizedEffort !== 'none'

  if (normalizedModel.startsWith('claude-')) {
    if (
      parameter === 'frequency_penalty' ||
      parameter === 'presence_penalty' ||
      parameter === 'seed'
    ) {
      return false
    }

    if (
      reasoningEnabled &&
      (parameter === 'temperature' || parameter === 'top_p')
    ) {
      return false
    }
  }

  if (
    normalizedModel.startsWith('gemini-') &&
    (parameter === 'frequency_penalty' || parameter === 'presence_penalty')
  ) {
    return false
  }

  if (
    reasoningEnabled &&
    OPENAI_REASONING_MODEL.test(normalizedModel) &&
    parameter !== 'max_tokens'
  ) {
    return false
  }

  return true
}
