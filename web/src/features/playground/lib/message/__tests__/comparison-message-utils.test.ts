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
import { describe, expect, test } from 'vitest'

import type { Message } from '../../../types'
import {
  clonePlaygroundMessagesForLane,
  getPlaygroundLaneMessages,
  tagPlaygroundTurn,
  updatePlaygroundLaneMessages,
} from '../comparison-message-utils'

const createMessage = (
  key: string,
  from: Message['from'],
  lane?: Message['lane']
): Message => ({
  key,
  from,
  versions: [{ id: `${key}-version`, content: key }],
  lane,
})

describe('comparison message lanes', () => {
  test('clones existing primary context into an independent secondary lane', () => {
    const primaryMessages = [
      {
        ...createMessage('primary-user', 'user', 'primary'),
        turnId: 'existing-turn',
      },
      {
        ...createMessage('primary-assistant', 'assistant', 'primary'),
        turnId: 'existing-turn',
      },
    ]

    const cloned = clonePlaygroundMessagesForLane(primaryMessages, 'secondary')

    expect(cloned).toHaveLength(primaryMessages.length)
    expect(cloned.map(({ lane }) => lane)).toEqual(['secondary', 'secondary'])
    expect(cloned.map(({ turnId }) => turnId)).toEqual([
      'existing-turn',
      'existing-turn',
    ])
    expect(cloned.map(({ key }) => key)).not.toEqual(
      primaryMessages.map(({ key }) => key)
    )
    expect(cloned.map(({ versions }) => versions[0].content)).toEqual([
      'primary-user',
      'primary-assistant',
    ])
    expect(cloned.map(({ versions }) => versions[0].id)).not.toEqual(
      primaryMessages.map(({ versions }) => versions[0].id)
    )
  })

  test('treats legacy messages as primary and filters each lane independently', () => {
    const messages = [
      createMessage('legacy', 'user'),
      createMessage('primary', 'assistant', 'primary'),
      createMessage('secondary', 'assistant', 'secondary'),
    ]

    expect(
      getPlaygroundLaneMessages(messages, 'primary').map(({ key }) => key)
    ).toEqual(['legacy', 'primary'])
    expect(
      getPlaygroundLaneMessages(messages, 'secondary').map(({ key }) => key)
    ).toEqual(['secondary'])
  })

  test('updates one lane without changing the other lane', () => {
    const primaryUser = createMessage('primary-user', 'user', 'primary')
    const secondaryUser = createMessage('secondary-user', 'user', 'secondary')
    const secondaryAssistant = {
      ...createMessage('secondary-assistant', 'assistant', 'secondary'),
      turnId: 'turn-secondary',
    }
    const messages = [primaryUser, secondaryUser, secondaryAssistant]

    const updated = updatePlaygroundLaneMessages(
      messages,
      'secondary',
      (laneMessages) =>
        laneMessages.map((message) =>
          message.from === 'assistant'
            ? {
                ...message,
                status: 'error' as const,
                errorCode: 'secondary_failed',
              }
            : message
        )
    )

    expect(updated[0]).toBe(primaryUser)
    expect(updated[1]).toEqual(secondaryUser)
    expect(updated[2]).toMatchObject({
      key: 'secondary-assistant',
      lane: 'secondary',
      turnId: 'turn-secondary',
      status: 'error',
      errorCode: 'secondary_failed',
    })
  })

  test('tags only the newly appended user and assistant with one turn id', () => {
    const existing = createMessage('existing', 'assistant', 'primary')
    const nextMessages = [
      existing,
      createMessage('new-user', 'user'),
      createMessage('new-assistant', 'assistant'),
    ]

    const tagged = tagPlaygroundTurn(
      nextMessages,
      1,
      'secondary',
      'shared-turn'
    )

    expect(tagged[0]).toBe(existing)
    expect(tagged.slice(1)).toEqual([
      expect.objectContaining({
        key: 'new-user',
        lane: 'secondary',
        turnId: 'shared-turn',
      }),
      expect.objectContaining({
        key: 'new-assistant',
        lane: 'secondary',
        turnId: 'shared-turn',
      }),
    ])
  })
})
