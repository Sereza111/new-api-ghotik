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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundComparisonLayout } from './components/comparison/playground-comparison-layout'
import { PlaygroundInput } from './components/input/playground-input'
import { PlaygroundSessionNavigation } from './components/sessions/playground-session-navigation'
import {
  usePlaygroundComparison,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { isImageGenerationModel } from './lib'
import type { ModelOption, PlaygroundConfig } from './types'

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    clearMessages,
    sessions,
    activeSessionId,
    isLoadingSessions,
    isSessionsError,
    isSessionBusy,
    sessionSaveStatus,
    selectSession,
    createSession,
    renameSession,
    removeSession,
    retrySessions,
  } = usePlaygroundState()
  const [secondaryModels, setSecondaryModels] = useState<ModelOption[]>([])
  const isImageMode = isImageGenerationModel(config.model)

  const comparison = usePlaygroundComparison({
    config,
    parameterEnabled,
    messages,
    updateMessages,
  })

  const handleClearMessages = () => {
    comparison.primary.conversation.handleEditOpenChange(false)
    comparison.secondary.conversation.handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels: isLoadingPrimaryModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  const updateSecondaryConfig = useCallback(
    function updateComparisonOption<K extends keyof PlaygroundConfig>(
      key: K,
      value: PlaygroundConfig[K]
    ): void {
      if (key !== 'model' && key !== 'group') return

      updateConfig('comparison', {
        ...config.comparison,
        [key]: value as string,
      })
    },
    [config.comparison, updateConfig]
  )

  const { isLoadingModels: isLoadingSecondaryModels } = usePlaygroundOptions({
    currentGroup: config.comparison.group,
    currentModel: config.comparison.model,
    setGroups,
    setModels: setSecondaryModels,
    updateConfig: updateSecondaryConfig,
  })

  const handleComparisonEnabledChange = (enabled: boolean) => {
    updateConfig('comparison', {
      ...config.comparison,
      enabled,
      model: config.comparison.model || config.model,
      group: config.comparison.group || config.group,
    })
  }

  const primaryConversation = comparison.primary.conversation
  const secondaryConversation = comparison.secondary.conversation
  const primaryChat = (
    <PlaygroundChat
      messages={comparison.primary.messages}
      isLoadingMessages={isLoadingMessages}
      onRegenerateMessage={primaryConversation.handleRegenerateMessage}
      onEditMessage={primaryConversation.handleEditMessage}
      onDeleteMessage={primaryConversation.handleDeleteMessage}
      onSelectPrompt={comparison.handleSendMessage}
      isGenerating={comparison.primary.handler.isGenerating}
      editingKey={primaryConversation.editingMessageKey}
      onCancelEdit={primaryConversation.handleEditOpenChange}
      onSaveEdit={(newContent) =>
        primaryConversation.applyEdit(newContent, false)
      }
      onSaveEditAndSubmit={(newContent) =>
        primaryConversation.applyEdit(newContent, true)
      }
      contentClassName={config.comparison.enabled ? 'max-w-none' : undefined}
    />
  )
  const secondaryChat = (
    <PlaygroundChat
      messages={comparison.secondary.messages}
      isLoadingMessages={isLoadingMessages}
      onRegenerateMessage={secondaryConversation.handleRegenerateMessage}
      onEditMessage={secondaryConversation.handleEditMessage}
      onDeleteMessage={secondaryConversation.handleDeleteMessage}
      onSelectPrompt={comparison.handleSendMessage}
      isGenerating={comparison.secondary.handler.isGenerating}
      editingKey={secondaryConversation.editingMessageKey}
      onCancelEdit={secondaryConversation.handleEditOpenChange}
      onSaveEdit={(newContent) =>
        secondaryConversation.applyEdit(newContent, false)
      }
      onSaveEditAndSubmit={(newContent) =>
        secondaryConversation.applyEdit(newContent, true)
      }
      contentClassName='max-w-none'
    />
  )

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden md:flex-row'>
      <PlaygroundSessionNavigation
        sessions={sessions}
        activeSessionId={activeSessionId}
        isLoading={isLoadingSessions}
        isError={isSessionsError}
        busy={isSessionBusy}
        generationActive={comparison.isGenerating}
        saveStatus={sessionSaveStatus}
        onCreate={createSession}
        onSelect={selectSession}
        onRename={renameSession}
        onDelete={removeSession}
        onRetry={() => void retrySessions()}
      />

      <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <PlaygroundComparisonLayout
            enabled={config.comparison.enabled}
            disabled={
              comparison.isGenerating ||
              isLoadingMessages ||
              !activeSessionId ||
              !config.model
            }
            onEnabledChange={handleComparisonEnabledChange}
            primary={{
              title: t('Primary model'),
              content: primaryChat,
              model: config.model,
              group: config.group,
              models,
              groups,
              isLoading: isLoadingPrimaryModels,
              isGenerating: comparison.primary.handler.isGenerating,
              onModelChange: (value) => updateConfig('model', value),
              onGroupChange: (value) => updateConfig('group', value),
              onStop: comparison.primary.handler.stopGeneration,
            }}
            secondary={{
              title: t('Secondary model'),
              content: secondaryChat,
              model: config.comparison.model,
              group: config.comparison.group,
              models: secondaryModels,
              groups,
              isLoading: isLoadingSecondaryModels,
              isGenerating: comparison.secondary.handler.isGenerating,
              onModelChange: (value) => updateSecondaryConfig('model', value),
              onGroupChange: (value) => updateSecondaryConfig('group', value),
              onStop: comparison.secondary.handler.stopGeneration,
            }}
          />
        </div>

        <div className='mx-auto w-full max-w-7xl'>
          <PlaygroundInput
            config={config}
            disabled={
              comparison.isGenerating ||
              isLoadingMessages ||
              !activeSessionId ||
              (config.comparison.enabled && !config.comparison.model)
            }
            groups={groups}
            groupValue={config.group}
            isGenerating={comparison.isGenerating}
            isImageMode={isImageMode}
            isModelLoading={isLoadingPrimaryModels}
            modelValue={config.model}
            models={models}
            onGroupChange={(value) => updateConfig('group', value)}
            onConfigChange={updateConfig}
            onClearMessages={handleClearMessages}
            onModelChange={(value) => updateConfig('model', value)}
            onParameterEnabledChange={updateParameterEnabled}
            onStop={comparison.stopAll}
            onSubmit={comparison.handleSendMessage}
            parameterEnabled={parameterEnabled}
            hasMessages={messages.length > 0}
          />
        </div>
      </div>
    </div>
  )
}
