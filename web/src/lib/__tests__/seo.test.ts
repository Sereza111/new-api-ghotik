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
import { beforeEach, describe, expect, it } from 'vitest'

import { applySeoMetadata, resolveSeoMetadata } from '../seo'

describe('SEO metadata', () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title>New API</title>
      <meta name="title" content="New API" />
      <meta name="description" content="" />
      <meta name="robots" content="" />
      <meta property="og:title" content="" />
      <meta property="og:description" content="" />
      <meta property="og:url" content="" />
      <meta name="twitter:title" content="" />
      <meta name="twitter:description" content="" />
      <link rel="canonical" href="" />
    `
  })

  it('returns indexable Russian metadata for a public page with a trailing slash', () => {
    const metadata = resolveSeoMetadata('/pricing/')

    expect(metadata.indexable).toBe(true)
    expect(metadata.canonicalPath).toBe('/pricing')
    expect(metadata.title).toContain('New API')
    expect(metadata.description).toContain('моделей')
  })

  it('marks authenticated and unknown routes as non-indexable', () => {
    const metadata = resolveSeoMetadata('/dashboard/overview')

    expect(metadata.indexable).toBe(false)
    expect(metadata.canonicalPath).toBe('/')
  })

  it('updates canonical and crawler directives when the route changes', () => {
    applySeoMetadata('/docs')

    expect(document.title).toContain('Документация API')
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute('content')
    ).toContain('index, follow')
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href')
    ).toBe('https://new-api.yozik.ru/docs')

    applySeoMetadata('/wallet')

    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute('content')
    ).toBe('noindex, nofollow')
  })
})
