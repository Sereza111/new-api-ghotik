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
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ServiceStatus } from '../index'

const useStatusMock = vi.fn()
const usePricingDataMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      values?.count === undefined
        ? key
        : key.replace('{{count}}', String(values.count)),
  }),
}))

vi.mock('@/components/layout/components/public-layout', () => ({
  PublicLayout: (props: { children: React.ReactNode }) => props.children,
}))

vi.mock('@/components/page-transition', () => ({
  PageTransition: (props: { children: React.ReactNode }) => props.children,
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => useStatusMock(),
}))

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: () => usePricingDataMock(),
}))

describe('ServiceStatus', () => {
  beforeEach(() => {
    useStatusMock.mockReturnValue({ loading: false, error: null })
    usePricingDataMock.mockReturnValue({
      isLoading: false,
      error: null,
      models: [{ id: 1 }, { id: 2 }],
    })
  })

  test('reports operational state only when live checks and models are available', () => {
    render(<ServiceStatus />)

    expect(screen.getByText('All systems operational')).toBeInTheDocument()
    expect(screen.getByText('2 models available')).toBeInTheDocument()
  })

  test('reports degradation when the catalog check fails', () => {
    usePricingDataMock.mockReturnValue({
      isLoading: false,
      error: new Error('offline'),
      models: [],
    })

    render(<ServiceStatus />)

    expect(screen.getByText('Some systems are degraded')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })
})
