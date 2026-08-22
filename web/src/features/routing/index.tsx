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
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Boxes, Radio, Route, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PageTransition } from '@/components/page-transition'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserGroups, getUserModels } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export function Routing() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const queries = useQueries({
    queries: [
      { queryKey: ['user-groups'], queryFn: getUserGroups, staleTime: 300_000 },
      { queryKey: ['user-models'], queryFn: getUserModels, staleTime: 300_000 },
    ],
  })

  const groups = Object.entries(queries[0].data?.data ?? {})
  const modelCount = queries[1].data?.data?.length ?? 0
  const isLoading = queries.some((query) => query.isLoading)
  const hasError = queries.some((query) => query.isError)
  const isAdmin = (user?.role ?? ROLE.USER) >= ROLE.ADMIN

  let routingGroupsContent: ReactNode = groups.map(([name, group]) => (
    <div
      key={name}
      className='grid grid-cols-[minmax(0,1fr)_8rem] items-center border-b px-4 py-3 last:border-b-0'
    >
      <div className='min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium'>{name}</span>
          {name === user?.group && (
            <Badge variant='secondary'>{t('Current')}</Badge>
          )}
        </div>
        {group.desc && (
          <p className='text-muted-foreground mt-0.5 truncate text-sm'>
            {group.desc}
          </p>
        )}
      </div>
      <span className='text-end font-mono text-sm tabular-nums'>
        ×{group.ratio}
      </span>
    </div>
  ))
  if (groups.length === 0) {
    routingGroupsContent = (
      <p className='text-muted-foreground p-6 text-center text-sm'>
        {t('No routing groups are available for this account.')}
      </p>
    )
  }
  if (isLoading) {
    routingGroupsContent = (
      <div className='flex flex-col gap-3 p-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
      </div>
    )
  }

  return (
    <PageTransition className='flex flex-col gap-6 p-4 md:p-6'>
      <header className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <Route className='text-primary size-6' aria-hidden='true' />
          <h1 className='font-serif text-2xl font-semibold'>{t('Routing')}</h1>
        </div>
        <p className='text-muted-foreground max-w-3xl text-sm leading-6'>
          {t(
            'Requests are routed by the server using model availability, channel priority, weight, and group access.'
          )}
        </p>
      </header>

      <section className='grid gap-3 md:grid-cols-3'>
        <RoutingMetric
          icon={ShieldCheck}
          label={t('Your routing group')}
          value={user?.group || t('default')}
        />
        <RoutingMetric
          icon={Boxes}
          label={t('Available models')}
          value={isLoading ? '...' : modelCount.toLocaleString()}
        />
        <RoutingMetric
          icon={Radio}
          label={t('Routing mode')}
          value={t('Server managed')}
        />
      </section>

      {hasError && (
        <Alert variant='destructive'>
          <Route />
          <AlertTitle>{t('Unable to load routing data')}</AlertTitle>
          <AlertDescription>
            {t('Refresh the page or try again later.')}
          </AlertDescription>
        </Alert>
      )}

      <section className='overflow-hidden rounded-md border'>
        <div className='grid grid-cols-[minmax(0,1fr)_8rem] border-b px-4 py-3 text-sm font-medium'>
          <span>{t('Available routing groups')}</span>
          <span className='text-end'>{t('Price multiplier')}</span>
        </div>
        {routingGroupsContent}
      </section>

      <Alert>
        <Route />
        <AlertTitle>{t('How routing works')}</AlertTitle>
        <AlertDescription>
          {t(
            'The gateway selects a healthy channel that supports the requested model. Users choose the model; administrators control providers, priorities, and weights.'
          )}
        </AlertDescription>
      </Alert>

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
              <ArrowRight data-icon='inline-end' />
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

type RoutingMetricProps = {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}

function RoutingMetric(props: RoutingMetricProps) {
  const Icon = props.icon
  return (
    <Card size='sm'>
      <CardHeader className='grid grid-cols-[auto_1fr] items-center gap-2'>
        <Icon className='text-muted-foreground size-4' aria-hidden='true' />
        <CardTitle className='text-muted-foreground font-sans text-xs font-medium'>
          {props.label}
        </CardTitle>
      </CardHeader>
      <CardContent className='font-serif text-xl font-semibold'>
        {props.value}
      </CardContent>
    </Card>
  )
}
