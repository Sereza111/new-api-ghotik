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
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const EXTENDED_REASONING_MODEL =
  /^(?:gpt-(?:5|6)|o[134](?:-|$)|claude-|gemini-)/i
const OPENAI_REASONING_MODEL = /^(?:gpt-(?:5|6)|o[134](?:-|$))/i

export function getReasoningEffortOptions(model: string): ReasoningEffort[] {
  return EXTENDED_REASONING_MODEL.test(model.trim())
    ? EXTENDED_REASONING_LEVELS
    : STANDARD_REASONING_LEVELS
}

export function normalizeReasoningEffort(
  model: string,
  effort: ReasoningEffort
): ReasoningEffort {
  const options = getReasoningEffortOptions(model)
  if (options.includes(effort)) return effort

  if (effort === 'minimal') return 'low'
  if (effort === 'xhigh' || effort === 'max') return 'high'
  return effort
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
