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
export const RESELLER_TERMS = [
  'unlimited',
  '7-days',
  '30-days',
  '90-days',
] as const

export type ResellerTerm = (typeof RESELLER_TERMS)[number]

export type ResellerDraftValues = {
  clientLabel: string
  tokenMillions: number
  markupPercent: number
  term: ResellerTerm
}

export type ResellerQuote = {
  cost: number
  clientPrice: number
  profit: number
}

export type ResellerConfig = {
  base_cost_per_million: number
  default_endpoint: string
}

export type ResellerKey = {
  id: number
  client_label: string
  token_millions: number
  remaining_tokens: number
  used_tokens: number
  markup_percent: number
  term: ResellerTerm
  endpoint: string
  key: string
  created_time: number
  expired_time: number
  status: number
  cost: number
  client_price: number
}

export type CreateResellerKeyRequest = {
  client_label: string
  token_millions: number
  markup_percent: number
  term: ResellerTerm
  request_id: string
}

export type ResellerApiResponse<T> = {
  success: boolean
  message?: string
  data?: T
}
