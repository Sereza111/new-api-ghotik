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
import { ArrowUp, ImageIcon, SquareIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PromptInputButton,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'

import { getInputControlState } from '../../lib'
import type { GroupOption, ModelOption } from '../../types'

type PlaygroundInputControlsProps = {
  disabled?: boolean
  groups: GroupOption[]
  groupValue: string
  isGenerating?: boolean
  isImageMode?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  modelValue: string
  onGroupChange: (value: string) => void
  onModelChange: (value: string) => void
  onStop?: () => void
  text: string
  tools: ReactNode
  reasoning?: ReactNode
}

export function PlaygroundInputControls({
  disabled,
  groups,
  groupValue,
  isGenerating,
  isImageMode = false,
  isModelLoading = false,
  models,
  modelValue,
  onGroupChange,
  onModelChange,
  onStop,
  text,
  tools,
  reasoning,
}: PlaygroundInputControlsProps) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const { canSubmit, isSelectorDisabled, shouldShowStop } =
    getInputControlState({
      disabled,
      groups,
      hasAttachments: !isImageMode && attachments.files.length > 0,
      hasStopHandler: Boolean(onStop),
      isGenerating,
      isModelLoading,
      models,
      text,
    })

  const renderSelector = () => (
    <ModelGroupSelector
      selectedModel={modelValue}
      models={models}
      onModelChange={onModelChange}
      selectedGroup={groupValue}
      groups={groups}
      onGroupChange={onGroupChange}
      disabled={isSelectorDisabled}
      className='h-9 max-w-[min(42vw,15rem)] rounded-full border-transparent bg-transparent px-2.5'
    />
  )

  const renderSubmitButton = () =>
    shouldShowStop ? (
      <PromptInputButton
        className='size-10 shrink-0 rounded-full'
        size='icon-sm'
        aria-label={t('Stop')}
        onClick={onStop}
        variant='default'
      >
        <SquareIcon className='fill-current' size={16} />
      </PromptInputButton>
    ) : (
      <PromptInputButton
        className='size-10 shrink-0 rounded-full'
        size='icon-sm'
        aria-label={isImageMode ? t('Generate') : t('Send')}
        disabled={!canSubmit}
        type='submit'
        variant='default'
      >
        {isImageMode ? (
          <ImageIcon size={18} aria-hidden='true' />
        ) : (
          <ArrowUp size={20} aria-hidden='true' />
        )}
      </PromptInputButton>
    )

  return (
    <div className='flex w-full min-w-0 items-end gap-1.5'>
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-1'>
        {tools}
        <div className='min-w-0'>{renderSelector()}</div>
        {reasoning}
      </div>
      {renderSubmitButton()}
    </div>
  )
}
