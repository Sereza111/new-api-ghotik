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
import { BrainCircuit, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  getReasoningEffortOptions,
  normalizeReasoningEffort,
} from '../../lib/parameters/model-capabilities'
import type { PlaygroundConfig, ReasoningEffort } from '../../types'

const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Ultra',
}

type PlaygroundReasoningControlProps = {
  config: PlaygroundConfig
  disabled?: boolean
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
}

export function PlaygroundReasoningControl({
  config,
  disabled,
  onConfigChange,
}: PlaygroundReasoningControlProps) {
  const { t } = useTranslation()
  const options = getReasoningEffortOptions(config.model)
  const selectedEffort = normalizeReasoningEffort(
    config.model,
    config.reasoning_effort
  )
  if (options.length <= 1) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-9 gap-1.5 rounded-full px-2.5 text-xs'
            disabled={disabled}
            aria-label={`${t('Reasoning effort')}: ${t(REASONING_LABELS[selectedEffort])}`}
          />
        }
      >
        <BrainCircuit className='size-4' aria-hidden='true' />
        <span>{t(REASONING_LABELS[selectedEffort])}</span>
        <ChevronDown className='size-3' aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' side='top' className='w-52 p-1.5'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Reasoning effort')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selectedEffort}
            onValueChange={(value) => {
              if (options.includes(value as ReasoningEffort)) {
                onConfigChange('reasoning_effort', value as ReasoningEffort)
              }
            }}
          >
            {options.map((effort) => (
              <DropdownMenuRadioItem
                className='min-h-10 px-2'
                key={effort}
                value={effort}
              >
                {t(REASONING_LABELS[effort])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
