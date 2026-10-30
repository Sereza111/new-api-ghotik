/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import { PurchasePlaceholder } from '../purchase-placeholder'

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
})

describe('model purchase placeholder', () => {
  test('opens the selected product and exposes direct support contacts', async () => {
    const user = userEvent.setup()

    render(
      <I18nextProvider i18n={i18n}>
        <PurchasePlaceholder modelName='gpt-5.4-mini' />
      </I18nextProvider>
    )

    await user.click(
      screen.getByRole('button', { name: 'Pay for gpt-5.4-mini' })
    )

    expect(
      screen.getByRole('dialog', { name: 'Purchase gpt-5.4-mini' })
    ).toBeVisible()
    expect(screen.getByText('gpt-5.4-mini')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Telegram' })).toHaveAttribute(
      'href',
      'https://t.me/VLTOKENmr'
    )
    expect(screen.getByRole('button', { name: 'Email' })).toHaveAttribute(
      'href',
      'mailto:seregaboj619@gmail.com'
    )
  })
})
