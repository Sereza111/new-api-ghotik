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
      className='bg-background relative grid min-h-svh max-w-none overflow-x-hidden'
    >
      <div
        aria-hidden='true'
        className='border-primary/20 pointer-events-none absolute inset-x-0 top-20 border-t'
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
      <div className='flex min-h-svh items-center justify-center px-4 pt-24 pb-8 sm:px-8 sm:pt-28'>
        <div className='relative w-full max-w-[520px]'>
          <div
            aria-hidden='true'
            className='border-primary/35 absolute -top-3 left-8 h-6 w-20 border-t border-l'
          />
          <div
            aria-hidden='true'
            className='border-primary/35 absolute right-8 -bottom-3 h-6 w-20 border-r border-b'
          />
          <div className='bg-card/70 border-border rounded-md border px-5 py-7 shadow-2xl shadow-black/25 sm:px-10 sm:py-10'>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
