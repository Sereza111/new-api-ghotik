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
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ReferralSummary } from '../components/referral-summary'
import type { ReferralOverview } from '../types'

const overview: ReferralOverview = {
  referral_code: 'member-test',
  registered_count: 9,
  qualified_count: 7,
  available_quota: 500000,
  pending_quota: 0,
  lifetime_quota: 500000,
  channel_reward_quota: 500000,
  topup_reward_percent: 5,
  level: {
    code: 'bronze',
    name: 'Bronze',
    current_threshold: 5,
    next_threshold: 25,
    progress_percent: 10,
    topup_fee_discount_percent: 1,
  },
}

describe('referral membership', () => {
  test('shows current and future levels with the next target supplied by the server', () => {
    render(
      <ReferralSummary
        overview={overview}
        referralLink='https://example.com/sign-up?aff=member-test'
        onTransfer={vi.fn()}
        transferDisabled={false}
      />
    )

    const levels = screen.getByRole('list', { name: 'Referral levels' })
    expect(within(levels).getAllByRole('listitem')).toHaveLength(4)
    expect(
      within(levels).getByText('Your current level').closest('li')
    ).toHaveAttribute('aria-current', 'step')
    expect(
      screen.getByText('18 more qualified referrals to the next level')
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '10'
    )
  })

  test('keeps the highest level complete without presenting a nonexistent next target', () => {
    render(
      <ReferralSummary
        overview={{
          ...overview,
          level: {
            ...overview.level,
            code: 'gold',
            name: 'Gold',
            next_threshold: null,
            progress_percent: 100,
          },
        }}
        referralLink='https://example.com/sign-up?aff=member-test'
        onTransfer={vi.fn()}
        transferDisabled={false}
      />
    )

    expect(
      screen.getByText('Highest referral level reached')
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/more qualified referrals to the next level/)
    ).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
  })

  test('makes balance transfer available only when rewards can be transferred', () => {
    const transfer = vi.fn()
    const props = {
      overview,
      referralLink: 'https://example.com/sign-up?aff=member-test',
      onTransfer: transfer,
    }
    const { rerender } = render(<ReferralSummary {...props} transferDisabled />)
    const button = screen.getByRole('button', { name: 'Transfer to Balance' })
    expect(button).toBeDisabled()
    rerender(<ReferralSummary {...props} transferDisabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Transfer to Balance' }))
    expect(transfer).toHaveBeenCalledOnce()
  })

  test('keeps an unknown server level visible without inventing its position in the ladder', () => {
    render(
      <ReferralSummary
        overview={{
          ...overview,
          level: { ...overview.level, code: 'platinum', name: 'Platinum' },
        }}
        referralLink='https://example.com/sign-up?aff=member-test'
        onTransfer={vi.fn()}
        transferDisabled={false}
      />
    )

    expect(
      screen.getByRole('heading', { name: 'Platinum' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Referral levels' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '10'
    )
  })
})
