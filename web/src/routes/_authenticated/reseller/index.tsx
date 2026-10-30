import { createFileRoute } from '@tanstack/react-router'

import { Reseller } from '@/features/reseller'

export const Route = createFileRoute('/_authenticated/reseller/')({
  component: Reseller,
})
