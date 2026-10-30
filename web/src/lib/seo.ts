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

const SITE_ORIGIN = 'https://new-api.yozik.ru'
const DEFAULT_DESCRIPTION =
  'VL API — единый шлюз к моделям GPT, Claude, Gemini, Grok и DeepSeek. Один API-ключ, прозрачные цены, пополнение баланса и статистика запросов.'

type SeoMetadata = {
  title: string
  description: string
  canonicalPath: string
  indexable: boolean
}

const publicPages: Record<string, SeoMetadata> = {
  '/': {
    title: 'New API — VL API: единый API для нейросетей',
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
    indexable: true,
  },
  '/pricing': {
    title: 'Модели и цены — GPT, Claude, Gemini и Grok | VL API · New API',
    description:
      'Сравните актуальные цены и возможности моделей GPT, Claude, Gemini, Grok и DeepSeek в едином каталоге VL API.',
    canonicalPath: '/pricing',
    indexable: true,
  },
  '/rankings': {
    title: 'Рейтинг моделей искусственного интеллекта | VL API · New API',
    description:
      'Рейтинг популярных моделей ИИ по реальному объёму использования через VL API.',
    canonicalPath: '/rankings',
    indexable: true,
  },
  '/docs': {
    title: 'Документация API и примеры подключения | VL API · New API',
    description:
      'Документация VL API: создание ключа, адрес API, авторизация и примеры запросов к моделям искусственного интеллекта.',
    canonicalPath: '/docs',
    indexable: true,
  },
  '/service-status': {
    title: 'Статус сервиса и моделей | VL API · New API',
    description:
      'Проверьте доступность API-шлюза, успешность запросов, задержку и состояние моделей VL API.',
    canonicalPath: '/service-status',
    indexable: true,
  },
  '/support': {
    title: 'Поддержка пользователей | VL API · New API',
    description:
      'Контакты поддержки VL API по вопросам подключения, оплаты и работы с API.',
    canonicalPath: '/support',
    indexable: true,
  },
  '/about': {
    title: 'О сервисе VL API | New API',
    description:
      'VL API объединяет популярные модели искусственного интеллекта за одним совместимым API и прозрачной системой оплаты.',
    canonicalPath: '/about',
    indexable: true,
  },
  '/privacy-policy': {
    title: 'Политика конфиденциальности | VL API · New API',
    description:
      'Политика обработки и защиты персональных данных пользователей сервиса VL API.',
    canonicalPath: '/privacy-policy',
    indexable: true,
  },
  '/user-agreement': {
    title: 'Пользовательское соглашение | VL API · New API',
    description:
      'Условия использования сервиса VL API, права и обязанности пользователей платформы.',
    canonicalPath: '/user-agreement',
    indexable: true,
  },
}

function normalizePathname(pathname: string): string {
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/, '')
}

export function resolveSeoMetadata(pathname: string): SeoMetadata {
  const normalizedPathname = normalizePathname(pathname)
  const publicPage = publicPages[normalizedPathname]
  if (publicPage) return publicPage

  return {
    title: 'New API | VL API',
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/',
    indexable: false,
  }
}

function setMetaContent(selector: string, content: string): void {
  const element = document.querySelector<HTMLMetaElement>(selector)
  element?.setAttribute('content', content)
}

export function applySeoMetadata(pathname: string): void {
  const metadata = resolveSeoMetadata(pathname)
  const canonicalUrl = new URL(metadata.canonicalPath, SITE_ORIGIN).toString()
  const robots = metadata.indexable
    ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    : 'noindex, nofollow'

  document.title = metadata.title
  setMetaContent('meta[name="title"]', metadata.title)
  setMetaContent('meta[name="description"]', metadata.description)
  setMetaContent('meta[name="robots"]', robots)
  setMetaContent('meta[property="og:title"]', metadata.title)
  setMetaContent('meta[property="og:description"]', metadata.description)
  setMetaContent('meta[property="og:url"]', canonicalUrl)
  setMetaContent('meta[name="twitter:title"]', metadata.title)
  setMetaContent('meta[name="twitter:description"]', metadata.description)

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  )
  canonical?.setAttribute('href', canonicalUrl)
}
