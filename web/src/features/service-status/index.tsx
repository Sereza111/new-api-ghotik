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
import { Activity, Database, Route, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout/components/public-layout'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useStatus } from '@/hooks/use-status'

export function ServiceStatus() {
  const { t } = useTranslation()
  const statusQuery = useStatus()
  const pricingQuery = usePricingData()
  const gatewayReady = !statusQuery.loading && !statusQuery.error
  const catalogReady = !pricingQuery.isLoading && !pricingQuery.error
  const modelsReady = catalogReady && pricingQuery.models.length > 0
  const allOperational = gatewayReady && catalogReady && modelsReady

  const checks = [
    {
      title: t('API gateway'),
      description: t('Authentication, billing, and request processing'),
      ready: gatewayReady,
      icon: Server,
      detail: gatewayReady ? t('Operational') : t('Unavailable'),
    },
    {
      title: t('Model catalog'),
      description: t('Pricing and available model metadata'),
      ready: catalogReady,
      icon: Database,
      detail: catalogReady
        ? t('{{count}} models available', { count: pricingQuery.models.length })
        : t('Unavailable'),
    },
    {
      title: t('Model routing'),
      description: t('Routes requests to configured provider channels'),
      ready: modelsReady,
      icon: Route,
      detail: modelsReady ? t('Operational') : t('Degraded'),
    },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-24 pb-14 sm:px-6 lg:px-8'>
        <header className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <Activity className='text-primary size-6' aria-hidden='true' />
            <h1 className='font-serif text-3xl font-semibold sm:text-4xl'>
              {t('Service Status')}
            </h1>
            <Badge variant={allOperational ? 'secondary' : 'warning'}>
              {allOperational
                ? t('All systems operational')
                : t('Some systems are degraded')}
            </Badge>
          </div>
          <p className='text-muted-foreground max-w-2xl text-sm leading-6'>
            {t(
              'Live checks show whether the gateway and model catalog are responding right now.'
            )}
          </p>
        </header>

        <section className='overflow-hidden rounded-md border'>
          {checks.map((check, index) => {
            const Icon = check.icon
            return (
              <div key={check.title}>
                {index > 0 && <Separator />}
                <div className='grid gap-4 p-4 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center'>
                  <div className='bg-muted flex size-8 items-center justify-center rounded-sm'>
                    <Icon className='size-4' aria-hidden='true' />
                  </div>
                  <div>
                    <h2 className='font-medium'>{check.title}</h2>
                    <p className='text-muted-foreground mt-0.5 text-sm'>
                      {check.description}
                    </p>
                  </div>
                  <div className='flex items-center gap-2 text-sm sm:justify-self-end'>
                    <span
                      className={
                        check.ready
                          ? 'bg-success size-2 rounded-full'
                          : 'bg-warning size-2 rounded-full'
                      }
                      aria-hidden='true'
                    />
                    <span>{check.detail}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </section>

        <p className='text-muted-foreground text-xs'>
          {t(
            'This page reports current application availability and does not claim historical uptime.'
          )}
        </p>
      </PageTransition>
    </PublicLayout>
  )
}
