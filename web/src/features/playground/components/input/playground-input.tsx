import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { getSubmittableInputText } from '../../lib'
import type {
  ModelOption,
  GroupOption,
  ParameterEnabled,
  PlaygroundConfig,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  isImageMode?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  onClearMessages?: () => void
  onParameterEnabledChange: (
    key: keyof ParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ParameterEnabled
}

export function PlaygroundInput({
  config,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  isImageMode = false,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onConfigChange,
  onClearMessages,
  onParameterEnabledChange,
  parameterEnabled,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const handleSubmit = (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (!submittableText) return
    onSubmit(submittableText)
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        onSubmit={handleSubmit}
      >
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            isImageMode
              ? t('Describe the image you want to create')
              : t('Ask anything')
          }
          value={text}
        />

        {!isImageMode ? (
          <div className='border-border/60 flex flex-wrap items-center gap-2 border-t px-3 py-2'>
            <span className='text-muted-foreground mr-1 text-xs font-medium'>
              {t('Reasoning effort')}
            </span>
            <ToggleGroup
              value={[config.reasoning_effort]}
              onValueChange={(value) => {
                const nextValue = value.find(
                  (item) => item !== config.reasoning_effort
                ) as PlaygroundConfig['reasoning_effort'] | undefined
                if (nextValue) onConfigChange('reasoning_effort', nextValue)
              }}
              aria-label={t('Reasoning effort')}
              variant='outline'
              size='sm'
              spacing={1}
              className='max-w-full flex-wrap'
            >
              {[
                ['none', t('Off')],
                ['low', t('Low')],
                ['medium', t('Medium')],
                ['high', t('High')],
              ].map(([value, label]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className='h-7 px-2.5 text-xs'
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : (
          <div className='border-border/60 text-muted-foreground flex items-center justify-between gap-3 border-t px-3 py-2 text-xs'>
            <span className='font-medium'>{t('Reasoning effort')}</span>
            <span>{t('Not used for image generation')}</span>
          </div>
        )}

        <PromptInputFooter className='border-border/60 bg-muted/20 dark:bg-muted/10 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isImageMode={isImageMode}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={text}
            tools={
              <PlaygroundInputTools
                config={config}
                disabled={disabled}
                isImageMode={isImageMode}
                hasMessages={hasMessages}
                onConfigChange={onConfigChange}
                onClearMessages={onClearMessages}
                onParameterEnabledChange={onParameterEnabledChange}
                parameterEnabled={parameterEnabled}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
