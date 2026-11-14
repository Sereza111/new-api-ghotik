import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { transferAffiliateQuota } from '@/features/wallet/api'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { generateAffiliateLink } from '@/features/wallet/lib'
import { getSelf } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import {
  getServerMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { getReferralOverview } from './api'
import { ReferralMetrics } from './components/referral-metrics'
import { ReferralRewardsTable } from './components/referral-rewards-table'
import { ReferralSummary } from './components/referral-summary'

export function Referral() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)

  const overviewQuery = useQuery({
    queryKey: ['referral-overview'],
    queryFn: async () => {
      const response = requireServerSuccess(await getReferralOverview())
      return response.data
    },
  })

  const transferMutation = useMutation({
    mutationFn: async (quota: number) =>
      requireServerSuccess(await transferAffiliateQuota({ quota })),
    onSuccess: async (response) => {
      toast.success(getServerMessage(response) || t('Transfer successful'))
      await Promise.all([
        getSelf(),
        queryClient.invalidateQueries({ queryKey: ['referral-overview'] }),
      ])
    },
    onError: (error) => handleServerError(error, t('Transfer failed')),
    meta: { errorToast: false },
  })

  const handleTransfer = async (amount: number) => {
    try {
      await transferMutation.mutateAsync(amount)
      return true
    } catch {
      return false
    }
  }

  const overview = overviewQuery.data
  const referralLink = overview
    ? generateAffiliateLink(overview.referral_code)
    : ''

  let referralContent: ReactNode
  if (overviewQuery.isPending) {
    referralContent = (
      <div className='space-y-4' aria-label={t('Loading referrals')}>
        <Skeleton className='h-64 w-full rounded-md' />
        <Skeleton className='h-24 w-full rounded-md' />
      </div>
    )
  } else if (overviewQuery.isError || !overview) {
    referralContent = (
      <ErrorState
        title={t('Failed to load referral data')}
        description={t('Please try again in a moment.')}
        onRetry={() => void overviewQuery.refetch()}
      />
    )
  } else {
    referralContent = (
      <>
        <ReferralSummary
          overview={overview}
          referralLink={referralLink}
          onTransfer={() => setTransferDialogOpen(true)}
          transferDisabled={overview.available_quota <= 0}
        />
        <ReferralMetrics overview={overview} />
        <ReferralRewardsTable />
      </>
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Referral Program')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-5'>
            {referralContent}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={overview?.available_quota ?? 0}
        transferring={transferMutation.isPending}
      />
    </>
  )
}
