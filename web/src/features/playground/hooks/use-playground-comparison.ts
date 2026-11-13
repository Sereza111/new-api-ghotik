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
import { nanoid } from 'nanoid'
import { useCallback, useMemo } from 'react'

import {
  appendUserMessagePair,
  clonePlaygroundMessagesForLane,
  getPlaygroundLaneMessages,
  tagPlaygroundTurn,
  updatePlaygroundLaneMessages,
  type MessageStateUpdater,
} from '../lib'
import type {
  InputFileAttachment,
  Message,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundLane,
} from '../types'
import { useChatHandler } from './use-chat-handler'
import { usePlaygroundConversation } from './use-playground-conversation'

type UsePlaygroundComparisonOptions = {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  messages: Message[]
  updateMessages: (updater: MessageStateUpdater) => void
}

export function usePlaygroundComparison({
  config,
  parameterEnabled,
  messages,
  updateMessages,
}: UsePlaygroundComparisonOptions) {
  const primaryMessages = useMemo(
    () => getPlaygroundLaneMessages(messages, 'primary'),
    [messages]
  )
  const secondaryMessages = useMemo(
    () => getPlaygroundLaneMessages(messages, 'secondary'),
    [messages]
  )

  const createLaneUpdater = useCallback(
    (lane: PlaygroundLane) =>
      (updater: MessageStateUpdater): void => {
        updateMessages((currentMessages) =>
          updatePlaygroundLaneMessages(currentMessages, lane, updater)
        )
      },
    [updateMessages]
  )
  const updatePrimaryMessages = useMemo(
    () => createLaneUpdater('primary'),
    [createLaneUpdater]
  )
  const updateSecondaryMessages = useMemo(
    () => createLaneUpdater('secondary'),
    [createLaneUpdater]
  )

  const secondaryConfig = useMemo<PlaygroundConfig>(
    () => ({
      ...config,
      model: config.comparison.model,
      group: config.comparison.group,
    }),
    [config]
  )

  const primaryHandler = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updatePrimaryMessages,
  })
  const secondaryHandler = useChatHandler({
    config: secondaryConfig,
    parameterEnabled,
    onMessageUpdate: updateSecondaryMessages,
  })

  const primaryConversation = usePlaygroundConversation({
    messages: primaryMessages,
    updateMessages: updatePrimaryMessages,
    sendChat: primaryHandler.sendChat,
  })
  const secondaryConversation = usePlaygroundConversation({
    messages: secondaryMessages,
    updateMessages: updateSecondaryMessages,
    sendChat: secondaryHandler.sendChat,
  })

  const handleSendMessage = useCallback(
    (
      text: string,
      inputImages: string[] = [],
      inputFiles: InputFileAttachment[] = []
    ) => {
      const turnId = nanoid()
      const nextPrimaryMessages = tagPlaygroundTurn(
        appendUserMessagePair(primaryMessages, text, inputImages, inputFiles),
        primaryMessages.length,
        'primary',
        turnId
      )
      const nextSecondaryMessages = config.comparison.enabled
        ? tagPlaygroundTurn(
            appendUserMessagePair(
              secondaryMessages.length > 0
                ? secondaryMessages
                : clonePlaygroundMessagesForLane(primaryMessages, 'secondary'),
              text,
              inputImages,
              inputFiles
            ),
            secondaryMessages.length > 0
              ? secondaryMessages.length
              : primaryMessages.length,
            'secondary',
            turnId
          )
        : null

      updateMessages((currentMessages) => {
        const withPrimary = updatePlaygroundLaneMessages(
          currentMessages,
          'primary',
          nextPrimaryMessages
        )

        return nextSecondaryMessages
          ? updatePlaygroundLaneMessages(
              withPrimary,
              'secondary',
              nextSecondaryMessages
            )
          : withPrimary
      })

      primaryHandler.sendChat(nextPrimaryMessages)
      if (nextSecondaryMessages) {
        secondaryHandler.sendChat(nextSecondaryMessages)
      }
    },
    [
      config.comparison.enabled,
      primaryHandler,
      primaryMessages,
      secondaryHandler,
      secondaryMessages,
      updateMessages,
    ]
  )

  const stopAll = useCallback(() => {
    primaryHandler.stopGeneration()
    secondaryHandler.stopGeneration()
  }, [primaryHandler, secondaryHandler])

  return {
    primary: {
      messages: primaryMessages,
      handler: primaryHandler,
      conversation: primaryConversation,
    },
    secondary: {
      messages: secondaryMessages,
      handler: secondaryHandler,
      conversation: secondaryConversation,
    },
    handleSendMessage,
    stopAll,
    isGenerating: primaryHandler.isGenerating || secondaryHandler.isGenerating,
  }
}
