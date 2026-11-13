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

import type { Message, PlaygroundLane } from '../../types'
import {
  applyMessageStateUpdate,
  type MessageStateUpdater,
} from '../state/playground-state-utils'

export function getPlaygroundMessageLane(message: Message): PlaygroundLane {
  return message.lane ?? 'primary'
}

export function getPlaygroundLaneMessages(
  messages: Message[],
  lane: PlaygroundLane
): Message[] {
  return messages.filter(
    (message) => getPlaygroundMessageLane(message) === lane
  )
}

export function clonePlaygroundMessagesForLane(
  messages: Message[],
  lane: PlaygroundLane
): Message[] {
  return messages.map((message) => ({
    ...message,
    key: nanoid(),
    lane,
    versions: message.versions.map((version) => ({
      ...version,
      id: nanoid(),
    })),
  }))
}

function normalizeLaneMessages(
  messages: Message[],
  previousMessages: Message[],
  lane: PlaygroundLane
): Message[] {
  const previousByKey = new Map(
    previousMessages.map((message) => [message.key, message])
  )

  return messages.map((message, index) => {
    const previousMessage = previousByKey.get(message.key)
    const precedingTurnId =
      message.from === 'assistant' ? messages[index - 1]?.turnId : undefined

    return {
      ...message,
      lane,
      turnId: message.turnId ?? previousMessage?.turnId ?? precedingTurnId,
    }
  })
}

export function updatePlaygroundLaneMessages(
  messages: Message[],
  lane: PlaygroundLane,
  updater: MessageStateUpdater
): Message[] {
  const previousLaneMessages = getPlaygroundLaneMessages(messages, lane)
  const updatedLaneMessages = normalizeLaneMessages(
    applyMessageStateUpdate(previousLaneMessages, updater),
    previousLaneMessages,
    lane
  )
  let laneIndex = 0
  const mergedMessages: Message[] = []

  for (const message of messages) {
    if (getPlaygroundMessageLane(message) !== lane) {
      mergedMessages.push(message)
      continue
    }

    const updatedMessage = updatedLaneMessages[laneIndex]
    laneIndex += 1
    if (updatedMessage) {
      mergedMessages.push(updatedMessage)
    }
  }

  if (laneIndex < updatedLaneMessages.length) {
    mergedMessages.push(...updatedLaneMessages.slice(laneIndex))
  }

  return mergedMessages
}

export function tagPlaygroundTurn(
  messages: Message[],
  previousLength: number,
  lane: PlaygroundLane,
  turnId: string
): Message[] {
  return messages.map((message, index) =>
    index < previousLength ? message : { ...message, lane, turnId }
  )
}
