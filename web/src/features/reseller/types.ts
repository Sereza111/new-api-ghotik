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

export type DemoResellerKey = ResellerDraftValues &
  ResellerQuote & {
    id: string
    key: string
  }
