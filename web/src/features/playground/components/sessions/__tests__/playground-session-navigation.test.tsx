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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import type { PlaygroundSessionSummary } from '../../../types'
import { PlaygroundSessionNavigation } from '../playground-session-navigation'

Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
  configurable: true,
  value: () => [],
})

const sessions: PlaygroundSessionSummary[] = [
  {
    id: 'first-session',
    title: 'First chat',
    model: 'gpt-test',
    message_count: 3,
    revision: 2,
    created_at: 1,
    updated_at: 2,
  },
  {
    id: 'second-session',
    title: 'Second chat',
    model: 'gpt-test',
    message_count: 1,
    revision: 1,
    created_at: 1,
    updated_at: 1,
  },
]

function renderNavigation() {
  const callbacks = {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onSelect: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
    onRetry: vi.fn(),
  }

  render(
    <PlaygroundSessionNavigation
      sessions={sessions}
      activeSessionId='first-session'
      isLoading={false}
      isError={false}
      busy={false}
      generationActive={false}
      saveStatus='saved'
      {...callbacks}
    />
  )

  return callbacks
}

test('creates and switches playground sessions', async () => {
  const user = userEvent.setup()
  const { onCreate, onSelect } = renderNavigation()

  await user.click(screen.getByRole('button', { name: 'New chat' }))
  await user.click(screen.getByRole('button', { name: /Second chat/ }))

  expect(onCreate).toHaveBeenCalledOnce()
  expect(onSelect).toHaveBeenCalledWith('second-session')
})

test('renames and deletes a playground session', async () => {
  const user = userEvent.setup()
  const { onRename, onDelete } = renderNavigation()

  await user.click(screen.getAllByRole('button', { name: 'Chat actions' })[0])
  await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
  const input = await screen.findByRole('textbox', { name: 'Chat name' })
  await user.clear(input)
  await user.type(input, 'Renamed chat')
  await user.click(screen.getByRole('button', { name: 'Rename' }))

  expect(onRename).toHaveBeenCalledWith('first-session', 'Renamed chat')

  await user.click(screen.getAllByRole('button', { name: 'Chat actions' })[1])
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  await user.click(await screen.findByRole('button', { name: 'Delete' }))

  expect(onDelete).toHaveBeenCalledWith('second-session')
})
