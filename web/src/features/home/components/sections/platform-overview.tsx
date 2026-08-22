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
  ChartAverageIcon,
  Key01Icon,
  Route01Icon,
  ShieldKeyIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'

const PROVIDERS = ['OpenAI', 'Claude', 'Gemini', 'Grok', 'DeepSeek']

export function PlatformOverview() {
  const { t } = useTranslation()
  const capabilities = [
    {
      icon: Key01Icon,
      title: t('One key for every model'),
      description: t(
        'Create a key once and use it in compatible applications without rebuilding your integration.'
      ),
    },
    {
      icon: Route01Icon,
      title: t('Routing under your control'),
      description: t(
        'Choose model groups and channels while the gateway keeps the client endpoint unchanged.'
      ),
    },
    {
      icon: ChartAverageIcon,
      title: t('Usage you can actually read'),
      description: t(
        'See requests, balance and spending in one panel before costs become a surprise.'
      ),
    },
  ]

  return (
    <section className='border-border/60 border-b px-5 py-20 md:px-8 md:py-28'>
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end'>
          <div>
            <p className='text-primary text-xs font-semibold tracking-[0.14em] uppercase'>
              {t('The gateway, without the maze')}
            </p>
            <h2 className='mt-4 max-w-lg font-serif text-4xl leading-[1.02] font-semibold md:text-6xl'>
              {t('One key. Three layers of control.')}
            </h2>
          </div>
          <p className='text-muted-foreground max-w-xl text-sm leading-7 md:text-base'>
            {t(
              'VL keeps the daily path short: fund the balance, create a key and connect the application you already use.'
            )}
          </p>
        </AnimateInView>

        <div className='border-border/60 mt-12 border-y'>
          {capabilities.map((capability, index) => (
            <AnimateInView
              key={capability.title}
              delay={index * 80}
              className='border-border/60 grid gap-4 border-b py-7 last:border-b-0 md:grid-cols-[4rem_0.65fr_1.1fr] md:items-center md:gap-8 md:py-9'
            >
              <div className='border-border/70 bg-muted/20 flex size-11 items-center justify-center border'>
                <HugeiconsIcon icon={capability.icon} className='size-5' />
              </div>
              <h3 className='font-serif text-xl font-semibold'>
                {capability.title}
              </h3>
              <p className='text-muted-foreground max-w-xl text-sm leading-6'>
                {capability.description}
              </p>
            </AnimateInView>
          ))}
        </div>

        <AnimateInView className='mt-12 grid gap-8 border-b pb-12 lg:grid-cols-[1fr_auto] lg:items-center'>
          <div>
            <div className='flex flex-wrap gap-x-7 gap-y-3'>
              {PROVIDERS.map((provider) => (
                <span
                  key={provider}
                  className='text-muted-foreground font-serif text-sm'
                >
                  {provider}
                </span>
              ))}
            </div>
            <p className='text-muted-foreground mt-4 text-xs'>
              {t('Models change. Your endpoint stays the same.')}
            </p>
          </div>
          <Button variant='outline' render={<Link to='/service-status' />}>
            <HugeiconsIcon icon={ShieldKeyIcon} data-icon='inline-start' />
            {t('Check service status')}
          </Button>
        </AnimateInView>
      </div>
    </section>
  )
}
