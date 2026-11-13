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
import { useTranslation } from 'react-i18next'

import { Slider } from '@/components/ui/slider'

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
  const selectedIndex = Math.max(0, options.indexOf(selectedEffort))

  return (
    <div className='border-border/60 flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2.5'>
      <span className='text-muted-foreground shrink-0 text-xs font-medium'>
        {t('Reasoning effort')}
      </span>
      <div className='flex min-w-48 flex-1 items-center gap-3'>
        <Slider
          aria-label={t('Reasoning effort')}
          className='min-w-32 flex-1 py-1'
          disabled={disabled}
          max={options.length - 1}
          min={0}
          onValueChange={(nextValue) => {
            const nextIndex = Array.isArray(nextValue)
              ? nextValue[0]
              : nextValue
            const nextEffort = options[Math.round(nextIndex)]
            if (nextEffort) onConfigChange('reasoning_effort', nextEffort)
          }}
          step={1}
          value={[selectedIndex]}
        />
        <span className='border-border/70 bg-muted/45 text-foreground inline-flex h-7 w-16 shrink-0 items-center justify-center rounded-md border text-xs font-semibold'>
          {t(REASONING_LABELS[selectedEffort])}
        </span>
      </div>
    </div>
  )
}
