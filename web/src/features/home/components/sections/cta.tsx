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
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'

interface CTAProps {
  className?: string
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  if (props.isAuthenticated) {
    return null
  }

  return (
    <section className='border-border/60 bg-muted/25 relative z-10 border-t px-6 py-24 md:py-32'>
      <AnimateInView
        className='mx-auto max-w-2xl text-center'
        animation='scale-in'
      >
        <h2 className='font-serif text-3xl leading-none font-semibold tracking-normal md:text-5xl'>
          {t('Ready to simplify')}
          <br />
          <span className='text-primary'>{t('your AI integration?')}</span>
        </h2>
        <p className='text-muted-foreground mx-auto mt-6 max-w-md text-sm leading-relaxed md:text-base'>
          {t(
            'Deploy your own gateway and start routing requests through your configured upstream services.'
          )}
        </p>
        <div className='mt-9 flex flex-wrap items-center justify-center gap-3'>
          <Button size='lg' render={<Link to='/sign-up' />}>
            {t('Get Started')}
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon='inline-end'
              className='transition-transform group-hover/button:translate-x-0.5'
            />
          </Button>
          <Button variant='outline' size='lg' render={<Link to='/pricing' />}>
            {t('View Pricing')}
          </Button>
        </div>
      </AnimateInView>
    </section>
  )
}
