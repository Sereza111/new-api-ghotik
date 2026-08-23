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
*/
import { renderHook } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, test, vi } from 'vitest'

import { usePricingColumns } from '../pricing-columns'

vi.mock('@/lib/lobe-icon', () => ({
  getLobeIcon: () => null,
}))

const i18n = createInstance()

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })
})

function I18nWrapper(props: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{props.children}</I18nextProvider>
}

describe('pricing table columns', () => {
  test('exposes a purchase action for each model in the catalog', () => {
    const { result } = renderHook(() => usePricingColumns(), {
      wrapper: I18nWrapper,
    })

    expect(result.current.some((column) => column.id === 'purchase')).toBe(true)
  })
})
