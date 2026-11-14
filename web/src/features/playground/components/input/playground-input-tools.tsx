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
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInputButton,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type PlaygroundInputToolsProps = {
  disabled?: boolean
  hasMessages?: boolean
  onClearMessages?: () => void
}

export function PlaygroundInputTools(props: PlaygroundInputToolsProps) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  return (
    <>
      <PromptInputTools>
        <PromptInputButton
          aria-label={t('Add photos or files')}
          title={t('Add photos or files')}
          className='size-9 rounded-full'
          size='icon-sm'
          disabled={props.disabled}
          onClick={attachments.openFileDialog}
        >
          <Plus className='size-5' aria-hidden='true' />
        </PromptInputButton>
        {props.hasMessages && props.onClearMessages ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <PromptInputButton
                  aria-label={t('Chat actions')}
                  disabled={props.disabled}
                  className='size-9 rounded-full'
                  size='icon-sm'
                />
              }
            >
              <MoreHorizontal aria-hidden='true' />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='start'
              side='top'
              className='w-56 p-1.5'
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className='min-h-10'
                  variant='destructive'
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 aria-hidden='true' />
                  {t('Clear chat history')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </PromptInputTools>
      <ConfirmDialog
        destructive
        desc={t('Messages in this chat will be permanently deleted.')}
        confirmText={t('Clear')}
        handleConfirm={() => {
          props.onClearMessages?.()
          setClearConfirmOpen(false)
          toast.success(t('Conversation cleared'))
        }}
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Clear chat history?')}
      />
    </>
  )
}
