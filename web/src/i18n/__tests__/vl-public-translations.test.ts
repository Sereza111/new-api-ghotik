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

import en from '../locales/en.json'
import fr from '../locales/fr.json'
import ja from '../locales/ja.json'
import ru from '../locales/ru.json'
import vi from '../locales/vi.json'
import zhTW from '../locales/zh-TW.json'
import zh from '../locales/zh.json'

const locales = { en, fr, ja, ru, vi, zh, zhTW }
const heroKey = 'One API key. A deliberate choice of models.'

describe('VL public page translations', () => {
  test('stores public page copy inside the runtime translation namespace', () => {
    for (const locale of Object.values(locales)) {
      expect(locale.translation[heroKey]).toBeTruthy()
      expect(Object.hasOwn(locale, heroKey)).toBe(false)
    }
  })

  test('renders the new public page copy in Russian', () => {
    expect(ru.translation[heroKey]).toBe(
      'Один API-ключ. Осознанный выбор моделей.'
    )
    expect(ru.translation['The gateway, without the maze']).toBe(
      'API-шлюз без лишней сложности'
    )
    expect(ru.translation['About VL']).toBe('О VL')
  })
})
