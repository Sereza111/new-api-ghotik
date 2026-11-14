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
import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import {
  convertDetectedLanguage,
  INTERFACE_LANGUAGE_OPTIONS,
  normalizeInterfaceLanguage,
  type InterfaceLanguageCode,
} from './languages'

type LocaleResource = {
  translation: Record<string, string>
}

const localeLoaders: Record<
  InterfaceLanguageCode,
  () => Promise<{ default: LocaleResource }>
> = {
  en: () => import('./locales/en.json'),
  zhCN: () => import('./locales/zh.json'),
  fr: () => import('./locales/fr.json'),
  ru: () => import('./locales/ru.json'),
  ja: () => import('./locales/ja.json'),
  vi: () => import('./locales/vi.json'),
  zhTW: () => import('./locales/zh-TW.json'),
}

const localeBackend: BackendModule = {
  type: 'backend',
  init() {},
  async read(language, _namespace, callback) {
    const code = normalizeInterfaceLanguage(language) as InterfaceLanguageCode
    try {
      const module = await localeLoaders[code]()
      callback(null, module.default.translation)
    } catch (error: unknown) {
      callback(
        error instanceof Error
          ? error
          : new Error(`Unable to load locale: ${code}`),
        false
      )
    }
  },
}

export const i18nReady = i18n
  .use(LanguageDetector)
  .use(localeBackend)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: INTERFACE_LANGUAGE_OPTIONS.map(({ code }) => code),
    load: 'currentOnly',
    defaultNS: 'translation',
    ns: ['translation'],
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
      // codes (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
  })

export default i18n
