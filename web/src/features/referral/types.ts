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
export interface ReferralLevel {
  code: string
  name: string
  current_threshold: number
  next_threshold: number | null
  progress_percent: number
  topup_fee_discount_percent: number
}

export interface ReferralOverview {
  referral_code: string
  registered_count: number
  qualified_count: number
  available_quota: number
  pending_quota: number
  lifetime_quota: number
  channel_reward_quota: number
  topup_reward_percent: number
  level: ReferralLevel
}

export interface ReferralReward {
  id: number
  reward_type: string
  reward_quota: number
  status: string
  created_at: number
  available_at: number
  invitee_name: string
}

export interface ReferralRewardsPage {
  items: ReferralReward[]
  total: number
  page: number
  page_size: number
}

export interface ReferralApiResponse<T> {
  success: boolean
  message: string
  data: T
}
