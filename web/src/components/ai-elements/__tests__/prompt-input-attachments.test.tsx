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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputTextarea,
} from '../prompt-input'

describe('PromptInput clipboard attachments', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', {
      Image: 'Image',
      'Remove attachment': 'Remove attachment',
      Remove: 'Remove',
    })
  })

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:reference-image'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
    vi.unstubAllGlobals()
  })

  test('pastes an image, shows its preview, and allows removal', async () => {
    const user = userEvent.setup()
    const file = new File(['image'], 'reference.png', { type: 'image/png' })

    render(
      <PromptInput
        accept='image/png,image/jpeg,image/webp'
        onSubmit={() => undefined}
      >
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea />
      </PromptInput>
    )

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }],
      },
    })

    expect(screen.getByText('reference.png')).toBeVisible()
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)

    await user.click(screen.getByRole('button', { name: 'Remove attachment' }))

    expect(screen.queryByText('reference.png')).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference-image')
  })

  test('converts a pasted image to a data URL before submission', async () => {
    const file = new File(['image'], 'reference.png', { type: 'image/png' })
    const onSubmit = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => file }))
    )

    render(
      <PromptInput accept='image/png' onSubmit={onSubmit}>
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea />
      </PromptInput>
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }],
      },
    })
    fireEvent.change(textarea, { target: { value: 'Edit this image' } })
    const form = textarea.closest('form')
    expect(form).not.toBeNull()
    if (!form) {
      throw new Error('Prompt input form was not rendered')
    }
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        {
          text: 'Edit this image',
          files: [
            {
              type: 'file',
              url: 'data:image/png;base64,aW1hZ2U=',
              mediaType: 'image/png',
              filename: 'reference.png',
            },
          ],
        },
        expect.any(Object)
      )
    })
  })

  test('accepts a document by extension and submits it as a data URL', async () => {
    const file = new File(['report'], 'report.pdf', { type: '' })
    const onSubmit = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => file }))
    )

    render(
      <PromptInput accept='application/pdf,.pdf' onSubmit={onSubmit}>
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea />
      </PromptInput>
    )

    const input = screen.getByLabelText('Upload files')
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByText('report.pdf')).toBeVisible()

    const form = screen.getByRole('textbox').closest('form')
    expect(form).not.toBeNull()
    if (!form) throw new Error('Prompt input form was not rendered')
    fireEvent.submit(form)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        {
          text: '',
          files: [
            {
              type: 'file',
              url: 'data:application/octet-stream;base64,cmVwb3J0',
              mediaType: '',
              filename: 'report.pdf',
            },
          ],
        },
        expect.any(Object)
      )
    })
  })

  test('enforces the total attachment budget across additions and releases it on removal', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    render(
      <PromptInput
        accept='image/png'
        maxTotalFileSize={8}
        onError={onError}
        onSubmit={() => undefined}
      >
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea />
      </PromptInput>
    )
    const upload = screen.getByLabelText('Upload files')
    fireEvent.change(upload, {
      target: {
        files: [new File(['12345'], 'first.png', { type: 'image/png' })],
      },
    })
    fireEvent.change(upload, {
      target: {
        files: [new File(['1234'], 'second.png', { type: 'image/png' })],
      },
    })
    expect(screen.getByText('first.png')).toBeVisible()
    expect(screen.queryByText('second.png')).not.toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'max_total_file_size' })
    )

    await user.click(screen.getByRole('button', { name: 'Remove attachment' }))
    fireEvent.change(upload, {
      target: {
        files: [new File(['1234'], 'second.png', { type: 'image/png' })],
      },
    })
    expect(screen.getByText('second.png')).toBeVisible()
  })
})
