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

import { OverviewDashboard } from '../overview-dashboard'

const dashboardVisibilityMock = vi.fn()

vi.mock('@/features/dashboard/hooks/use-status-data', () => ({
  useDashboardContentVisibility: () => dashboardVisibilityMock(),
}))

vi.mock('../summary-cards', () => ({
  SummaryCards: () => <section aria-label='usage-summary' />,
}))

vi.mock('../announcements-panel', () => ({
  AnnouncementsPanel: () => <section aria-label='announcements' />,
}))

vi.mock('@/components/page-transition', () => ({
  CardStaggerContainer: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} />
  ),
  CardStaggerItem: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} />
  ),
}))

describe('OverviewDashboard', () => {
  beforeEach(() => {
    dashboardVisibilityMock.mockReturnValue({ announcements: true })
  })

  test('shows usage before announcements when announcements are enabled', () => {
    render(<OverviewDashboard />)

    const regions = screen.getAllByRole('region')
    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual([
      'usage-summary',
      'announcements',
    ])
  })

  test('keeps the usage summary focused when announcements are disabled', () => {
    dashboardVisibilityMock.mockReturnValue({ announcements: false })

    render(<OverviewDashboard />)

    expect(screen.getByRole('region', { name: 'usage-summary' })).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'announcements' })
    ).not.toBeInTheDocument()
  })
})
