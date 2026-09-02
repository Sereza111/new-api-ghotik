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
import {
  ArrowRight01Icon,
  Layers01Icon,
  Route01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { PageTransition } from '@/components/page-transition'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  getRoutingSources,
  resetRoutingSource,
  routingSourcesQueryKey,
  updateRoutingSource,
} from './api'
import { SourceSelector } from './source-selector'
import { SourceTable } from './source-table'
import type { RoutingSourceSelection, RoutingSourcesApiResponse } from './types'

export function Routing() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? ROLE.USER) >= ROLE.ADMIN

  const routingQuery = useQuery({
    queryKey: routingSourcesQueryKey,
    queryFn: async () => {
      const response = await getRoutingSources()
      if (!response.success || !response.data) {
        throw new Error(t('Unable to load routing sources'))
      }
      return response.data
    },
    staleTime: 300_000,
    retry: false,
  })

  const updateMutation = useMutation({
    mutationFn: async (
      selection: RoutingSourceSelection
    ): Promise<RoutingSourcesApiResponse> => {
      const response = selection.sourceId
        ? await updateRoutingSource(selection.familyId, selection.sourceId)
        : await resetRoutingSource(selection.familyId)
      if (!response.success || !response.data) {
        throw new Error(t('Failed to update source preference'))
      }
      return response
    },
    onSuccess: (response) => {
      queryClient.setQueryData(routingSourcesQueryKey, response.data)
      toast.success(t('Source preference updated'))
    },
    onError: () => {
      toast.error(t('Failed to update source preference'))
    },
  })

  let content: ReactNode
  if (routingQuery.isLoading) {
    content = <RoutingSkeleton loadingLabel={t('Loading routing sources')} />
  } else if (routingQuery.isError) {
    content = (
      <Alert variant='destructive'>
        <HugeiconsIcon icon={Route01Icon} strokeWidth={2} />
        <AlertTitle>{t('Unable to load routing sources')}</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-2'>
          <span>{t('Refresh the list and try again.')}</span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={routingQuery.isFetching}
            onClick={() => void routingQuery.refetch()}
          >
            {t('Try again')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else if (!routingQuery.data || routingQuery.data.families.length === 0) {
    content = (
      <Empty className='min-h-64 rounded-lg border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('No routing sources are available')}</EmptyTitle>
          <EmptyDescription>
            {t('This account has no selectable model sources.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    content = (
      <>
        <section aria-labelledby='routing-source-preferences-title'>
          <div className='mb-3 flex flex-wrap items-end justify-between gap-2'>
            <div>
              <h2
                id='routing-source-preferences-title'
                className='font-serif text-lg font-semibold'
              >
                {t('Model sources')}
              </h2>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t('Source preferences apply to this account.')}
              </p>
            </div>
          </div>
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {routingQuery.data.families.map((family) => (
              <SourceSelector
                key={family.id}
                family={family}
                disabled={updateMutation.isPending}
                saving={
                  updateMutation.isPending &&
                  updateMutation.variables?.familyId === family.id
                }
                onChange={(sourceId) =>
                  updateMutation.mutate({ familyId: family.id, sourceId })
                }
              />
            ))}
          </div>
        </section>

        <SourceTable
          families={routingQuery.data.families}
          sources={routingQuery.data.sources}
        />
      </>
    )
  }

  return (
    <PageTransition className='flex flex-col gap-5 p-4 md:p-6'>
      <header className='flex items-center gap-2'>
        <HugeiconsIcon
          icon={Route01Icon}
          strokeWidth={2}
          className='text-primary size-6'
          aria-hidden='true'
        />
        <h1 className='font-serif text-2xl font-semibold'>{t('Routing')}</h1>
      </header>

      {content}

      <div className='flex flex-wrap gap-2'>
        <Button variant='outline' render={<Link to='/pricing' />}>
          {t('View models')}
        </Button>
        <Button variant='outline' render={<Link to='/keys' />}>
          {t('API Keys')}
        </Button>
        {isAdmin && (
          <>
            <Button render={<Link to='/channels' />}>
              {t('Manage channels')}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                data-icon='inline-end'
              />
            </Button>
            <Button
              variant='outline'
              render={
                <Link to='/models/$section' params={{ section: 'metadata' }} />
              }
            >
              {t('Manage models')}
            </Button>
          </>
        )}
      </div>
    </PageTransition>
  )
}

function RoutingSkeleton(props: { loadingLabel: string }) {
  return (
    <div
      className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'
      aria-label={props.loadingLabel}
      aria-busy='true'
      aria-live='polite'
      role='status'
    >
      <Skeleton className='h-52 w-full rounded-lg' />
      <Skeleton className='h-52 w-full rounded-lg' />
      <Skeleton className='h-52 w-full rounded-lg' />
    </div>
  )
}
