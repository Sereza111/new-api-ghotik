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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type RefObject } from 'react'
import { describe, expect, test, vi } from 'vitest'

import {
  ModelPricingEditorPanel,
  type ModelRatioData,
  type ModelPricingEditorPanelHandle,
} from '../model-pricing-sheet'

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: () => ({
    models: [
      {
        model_name: 'gemini-3-flash',
        completion_ratio: 5.98936170212766,
      },
    ],
  }),
}))

const editData = {
  name: 'gemini-3-flash',
  ratio: '0.047',
  completionRatio: '5.98936170212766',
  billingMode: 'per-token' as const,
  referencePrice: {
    input_usd: 2.35,
    output_usd: 14.075,
  },
}

function renderEditor() {
  const editorRef = createRef<ModelPricingEditorPanelHandle>()
  render(<ModelPricingEditorPanel ref={editorRef} editData={editData} />)
  return editorRef
}

async function commitEditor(
  editorRef: RefObject<ModelPricingEditorPanelHandle | null>
): Promise<ModelRatioData | null> {
  let result: ModelRatioData | null = null
  await act(async () => {
    result = (await editorRef.current?.commitDraft()) ?? null
  })
  return result
}

describe('model pricing discount editor', () => {
  test('saves exact regular input and output prices', async () => {
    const user = userEvent.setup()
    const editorRef = renderEditor()
    const regularInput = screen.getByRole('textbox', {
      name: 'Regular input price',
    })
    const regularOutput = screen.getByRole('textbox', {
      name: 'Regular output price',
    })

    await waitFor(() => expect(regularInput).toHaveValue('2.35'))
    expect(regularOutput).toHaveValue('14.075')

    await user.clear(regularInput)
    await user.type(regularInput, '2.5')
    await user.clear(regularOutput)
    await user.type(regularOutput, '14.5')

    const result = await commitEditor(editorRef)

    expect(result?.referencePrice).toEqual({
      input_usd: 2.5,
      output_usd: 14.5,
    })
  })

  test('recalculates regular prices when the discount changes', async () => {
    const user = userEvent.setup()
    renderEditor()
    const discount = screen.getByRole('textbox', { name: 'Discount' })
    const regularInput = screen.getByRole('textbox', {
      name: 'Regular input price',
    })
    const regularOutput = screen.getByRole('textbox', {
      name: 'Regular output price',
    })

    await waitFor(() => expect(discount).toHaveValue('96'))
    await user.clear(discount)
    await user.type(discount, '50')

    expect(regularInput).toHaveValue('0.188')
    expect(regularOutput).toHaveValue('1.126')
  })

  test('rejects a regular price below the final price', async () => {
    const user = userEvent.setup()
    const editorRef = renderEditor()
    const regularInput = screen.getByRole('textbox', {
      name: 'Regular input price',
    })

    await waitFor(() => expect(regularInput).toHaveValue('2.35'))
    await user.clear(regularInput)
    await user.type(regularInput, '0.05')

    const result = await commitEditor(editorRef)

    expect(result).toBeNull()
    expect(
      screen.getByText('Regular prices must be greater than the final prices.')
    ).toBeInTheDocument()
  })
})
