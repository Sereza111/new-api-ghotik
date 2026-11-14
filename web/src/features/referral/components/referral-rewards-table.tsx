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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getReferralRewards } from '../api'
import type { ReferralReward } from '../types'

const EMPTY_REWARDS: ReferralReward[] = []

export function ReferralRewardsTable() {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const rewardsQuery = useQuery({
    queryKey: [
      'referral-rewards',
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const response = requireServerSuccess(
        await getReferralRewards(pagination.pageIndex + 1, pagination.pageSize)
      )
      return response.data
    },
    placeholderData: keepPreviousData,
  })

  const columns = useMemo<ColumnDef<ReferralReward>[]>(() => {
    const rewardTypes: Record<string, string> = {
      telegram_subscription: t('Channel subscription'),
      topup_commission: t('Top-up commission'),
    }
    const statuses: Record<
      string,
      { label: string; variant: StatusBadgeProps['variant'] }
    > = {
      available: { label: t('Available'), variant: 'success' },
      pending: { label: t('Pending'), variant: 'warning' },
      revoked: { label: t('Revoked'), variant: 'danger' },
    }

    return [
      {
        accessorKey: 'invitee_name',
        header: t('Invited user'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <span className='font-medium'>
            {row.original.invitee_name || t('Unknown')}
          </span>
        ),
        size: 190,
      },
      {
        accessorKey: 'reward_type',
        header: t('Reward type'),
        meta: { mobileOrder: 1 },
        cell: ({ row }) =>
          rewardTypes[row.original.reward_type] ?? t('Referral reward'),
        size: 180,
      },
      {
        accessorKey: 'reward_quota',
        header: t('Reward'),
        meta: { mobileOrder: 2 },
        cell: ({ row }) => (
          <span className='font-medium tabular-nums'>
            {formatQuota(row.original.reward_quota)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const status = statuses[row.original.status] ?? {
            label: t('Unknown'),
            variant: 'neutral' as const,
          }
          return (
            <StatusBadge
              label={status.label}
              variant={status.variant}
              copyable={false}
            />
          )
        },
        size: 120,
      },
      {
        accessorKey: 'available_at',
        header: t('Available at'),
        meta: { mobileOrder: 3 },
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap'>
            {formatTimestampToDate(row.original.available_at)}
          </span>
        ),
        size: 180,
      },
      {
        accessorKey: 'created_at',
        header: t('Created'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        ),
        size: 180,
      },
    ]
  }, [t])

  const data = rewardsQuery.isError
    ? EMPTY_REWARDS
    : (rewardsQuery.data?.items ?? EMPTY_REWARDS)
  const { table } = useDataTable({
    data,
    columns,
    getRowId: (reward) => String(reward.id),
    totalCount: rewardsQuery.isError ? 0 : (rewardsQuery.data?.total ?? 0),
    pagination,
    onPaginationChange: (updater) => {
      if (rewardsQuery.isFetching) return
      setPagination((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        return next.pageSize === previous.pageSize
          ? next
          : { pageIndex: 0, pageSize: next.pageSize }
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualPagination: true,
    withFacetedRowModel: false,
  })

  return (
    <section className='space-y-3'>
      <div>
        <h2 className='font-serif text-lg font-semibold'>
          {t('Reward history')}
        </h2>
        <p className='text-muted-foreground mt-0.5 text-sm'>
          {t('Referral rewards and their availability status.')}
        </p>
      </div>

      {rewardsQuery.isError ? (
        <Alert variant='destructive'>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
            <span>{t('Failed to load referral rewards')}</span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void rewardsQuery.refetch()}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={rewardsQuery.isPending}
        isFetching={rewardsQuery.isFetching}
        emptyTitle={t('No referral rewards yet')}
        emptyDescription={t(
          'Rewards will appear after invited users meet the referral conditions.'
        )}
        toolbarProps={null}
        fixedHeight={false}
        paginationInFooter={false}
        applyHeaderSize
        getColumnClassName={() => 'py-2.5'}
        skeletonKeyPrefix='referral-rewards'
      />
    </section>
  )
}
