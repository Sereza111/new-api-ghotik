import { nanoid } from 'nanoid'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'

import { getSubmittableInputText } from '../../lib'
import type {
  InputFileAttachment,
  ModelOption,
  GroupOption,
  PlaygroundConfig,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'
import { PlaygroundReasoningControl } from './playground-reasoning-control'

const REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const CHAT_ATTACHMENT_ACCEPT = [
  REFERENCE_IMAGE_ACCEPT,
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.docx',
].join(',')
const MAX_ATTACHMENTS = 20
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

type PromptAttachment = NonNullable<PromptInputMessage['files']>[number]

function isImageAttachment(file: PromptAttachment): boolean {
  const filename = file.filename?.toLowerCase() ?? ''
  return (
    file.mediaType?.toLowerCase().startsWith('image/') === true ||
    /\.(?:png|jpe?g|webp)$/.test(filename)
  )
}

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (
    text: string,
    inputImages?: string[],
    inputFiles?: InputFileAttachment[]
  ) => void | Promise<void>
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
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const handleSubmit = async (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(
      isImageMode ? { text: message.text } : message,
      disabled
    )

    if (submittableText === null) return
    const attachments = message.files ?? []
    const inputImages = [
      ...new Set(
        attachments
          .filter(isImageAttachment)
          .map((file) => file.url)
          .filter((url): url is string => Boolean(url))
      ),
    ]
    const inputFiles = attachments
      .filter((file) => !isImageAttachment(file))
      .flatMap((file) => {
        const filename = file.filename?.trim()
        const dataUrl = file.url?.trim()
        if (!filename || !dataUrl) return []
        const attachment: InputFileAttachment = {
          id: nanoid(),
          filename,
          dataUrl,
        }
        return [attachment]
      })

    await onSubmit(submittableText, inputImages, inputFiles)
    setText((currentText) => (currentText === message.text ? '' : currentText))
  }

  return (
    <div className='playground-composer px-3 pb-3 sm:px-5 sm:pb-5'>
      <PromptInput
        accept={isImageMode ? REFERENCE_IMAGE_ACCEPT : CHAT_ATTACHMENT_ACCEPT}
        className='relative'
        groupClassName='playground-composer-surface rounded-3xl overflow-hidden transition-colors focus-within:border-primary/45 has-disabled:opacity-100'
        maxFiles={MAX_ATTACHMENTS}
        maxFileSize={MAX_ATTACHMENT_BYTES}
        maxTotalFileSize={MAX_TOTAL_ATTACHMENT_BYTES}
        multiple
        onError={(error) => toast.error(error.message)}
        onSubmit={handleSubmit}
      >
        <PromptInputAttachments className='px-3 pt-3'>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>

        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='max-h-48 min-h-16 px-5 pt-4 pb-2 text-base leading-7 break-words'
          aria-label={t('Message')}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            isImageMode
              ? t('Describe the image you want to create')
              : t('Ask anything')
          }
          value={text}
        />

        <PromptInputFooter className='px-3 pt-1 pb-3'>
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
            reasoning={
              !isImageMode ? (
                <PlaygroundReasoningControl
                  config={config}
                  disabled={disabled}
                  onConfigChange={onConfigChange}
                />
              ) : undefined
            }
            tools={
              <PlaygroundInputTools
                disabled={disabled}
                hasMessages={hasMessages}
                onClearMessages={onClearMessages}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
