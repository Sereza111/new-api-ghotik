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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Docs } from '../index'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: PropsWithChildren<{ to: string }>) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/components/layout/components/public-layout', () => ({
  PublicLayout: (props: PropsWithChildren) => <div>{props.children}</div>,
}))

vi.mock('@/components/page-transition', () => ({
  PageTransition: (props: PropsWithChildren<{ className?: string }>) => (
    <main className={props.className}>{props.children}</main>
  ),
}))

describe('Codex platform guides', () => {
  it('switches from Windows paths to the macOS and Linux setup', async () => {
    const user = userEvent.setup()
    render(<Docs />)

    const windowsTab = screen.getByRole('tab', { name: 'Windows' })
    expect(windowsTab).toHaveAttribute('aria-selected', 'true')
    expect(
      within(screen.getByRole('tabpanel', { name: 'Windows' })).getByText(
        /windows_wsl_setup_acknowledged = true/
      )
    ).toBeInTheDocument()

    const unixTab = screen.getByRole('tab', { name: 'macOS / Linux' })
    await user.click(unixTab)

    expect(unixTab).toHaveAttribute('aria-selected', 'true')
    const unixPanel = screen.getByRole('tabpanel', { name: 'macOS / Linux' })
    expect(within(unixPanel).getByText('~/.codex/config.toml')).toBeVisible()
    expect(
      within(unixPanel).queryByText(/windows_wsl_setup_acknowledged/)
    ).toBeNull()
  })
})
