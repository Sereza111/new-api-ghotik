import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { DEFAULT_CONFIG } from '../../../constants'
import { PlaygroundInput } from '../playground-input'

function renderInput(
  generating = false,
  onSubmit: () => void | Promise<void> = vi.fn()
) {
  const onStop = vi.fn()
  const onConfigChange = vi.fn()
  render(
    <PlaygroundInput
      config={{ ...DEFAULT_CONFIG, model: 'claude-opus-4-6' }}
      onSubmit={onSubmit}
      onStop={onStop}
      disabled={generating}
      isGenerating={generating}
      models={[{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }]}
      modelValue='claude-opus-4-6'
      onModelChange={vi.fn()}
      groups={[]}
      groupValue='default'
      onGroupChange={vi.fn()}
      onConfigChange={onConfigChange}
    />
  )
  return { onStop, onConfigChange }
}

afterEach(() => vi.unstubAllGlobals())

test('keeps Stop usable while the request disables the composer', async () => {
  const user = userEvent.setup()
  const { onStop } = renderInput(true)
  const stop = screen.getByRole('button', { name: 'Stop' })
  expect(stop).toBeEnabled()
  await user.click(stop)
  expect(onStop).toHaveBeenCalledOnce()
})

test('accepts more than four photos in a message', () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL(file: File) {
        return `blob:${file.name}`
      }
      static revokeObjectURL() {}
    }
  )
  renderInput()
  const files = Array.from(
    { length: 5 },
    (_, index) =>
      new File(['photo'], `photo-${index}.png`, { type: 'image/png' })
  )
  fireEvent.change(screen.getByLabelText('Upload files'), { target: { files } })
  for (const file of files) expect(screen.getByText(file.name)).toBeVisible()
})

test('offers reasoning as an accessible choice without a parameter or search toggle', async () => {
  const user = userEvent.setup()
  const { onConfigChange } = renderInput()
  expect(
    screen.queryByRole('button', { name: 'Parameters' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Enable web search' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Reasoning effort/ }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'High' }))
  expect(onConfigChange).toHaveBeenCalledWith('reasoning_effort', 'high')
})

test('preserves text and attachments when asynchronous submission fails', async () => {
  let rejectSubmission: (error: Error) => void = () => undefined
  const submission = new Promise<void>((_, reject) => {
    rejectSubmission = reject
  })
  const onSubmit = vi.fn(() => submission)
  const photo = new File(['photo'], 'reference.png', { type: 'image/png' })
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:reference'
      }
      static revokeObjectURL() {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => photo }))
  )
  renderInput(false, onSubmit)
  fireEvent.change(screen.getByLabelText('Upload files'), {
    target: { files: [photo] },
  })
  const textarea = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(textarea, { target: { value: 'Inspect this photo' } })
  const form = textarea.closest('form')
  if (!form) throw new Error('Composer form not found')
  fireEvent.submit(form)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  expect(screen.getByText('reference.png')).toBeVisible()
  await act(async () => {
    rejectSubmission(new Error('Request failed'))
  })
  expect(screen.getByText('reference.png')).toBeVisible()
  expect(textarea).toHaveValue('Inspect this photo')
})
