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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { FortuneAtmosphere } from '@/features/home/components/fortune-atmosphere'
import { FortuneWheel } from '@/features/home/components/fortune-wheel'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <div
      data-auth-layout='gothic'
      className='bg-background fortune-atmosphere-surface relative grid min-h-svh max-w-none overflow-x-hidden'
    >
      <FortuneAtmosphere />
      <div
        aria-hidden='true'
        className='border-primary/20 pointer-events-none absolute inset-x-0 top-20 z-10 border-t'
      />
      <Link
        to='/'
        className='hover:text-primary absolute top-4 left-4 z-10 flex items-center gap-3 transition-colors sm:top-6 sm:left-8'
      >
        <div className='border-primary/35 bg-card relative grid h-9 w-9 place-items-center rounded-sm border shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_8%,transparent)]'>
          {loading ? (
            <Skeleton className='absolute inset-1 rounded-sm' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='h-7 w-7 rounded-sm object-cover'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <span className='font-serif text-xl font-semibold'>{systemName}</span>
        )}
      </Link>
      <div className='relative z-10 mx-auto grid min-h-svh w-full max-w-[1280px] items-center gap-10 px-4 pt-24 pb-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)] lg:pt-28'>
        <section className='hidden min-w-0 items-center gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem]'>
          <div className='min-w-0 space-y-6'>
            <p className='text-primary text-xs font-semibold uppercase'>
              {t('Secure access to your AI gateway')}
            </p>
            <div className='space-y-3'>
              <h1 className='font-serif text-5xl leading-[0.98] font-semibold xl:text-6xl'>
                {t('One key. Every model.')}
              </h1>
              <p className='text-muted-foreground max-w-xl text-base leading-7 xl:text-lg'>
                {t(
                  'Manage models, API keys, usage, and payments from one clear workspace.'
                )}
              </p>
            </div>
            <div className='grid max-w-xl grid-cols-3 border-y'>
              {[
                t('Unified API'),
                t('Transparent usage'),
                t('Live service status'),
              ].map((label, index) => (
                <div
                  key={label}
                  className='text-muted-foreground px-3 py-4 text-xs first:pl-0 [&:not(:last-child)]:border-r'
                >
                  <span className='text-primary mr-2 font-mono'>
                    0{index + 1}
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>
          <FortuneWheel />
        </section>

        <div className='relative w-full'>
          <div
            aria-hidden='true'
            className='border-primary/35 absolute -top-3 left-8 h-6 w-20 border-t border-l'
          />
          <div
            aria-hidden='true'
            className='border-primary/35 absolute right-8 -bottom-3 h-6 w-20 border-r border-b'
          />
          <div className='bg-card/80 border-border rounded-md border px-5 py-7 shadow-2xl shadow-black/25 backdrop-blur sm:px-9 sm:py-9'>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
