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
  BookOpen01Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'

import { FortuneWheel } from '../fortune-wheel'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'
  const isExternalDocs = docsUrl.startsWith('http')

  return (
    <section className='border-border/60 relative overflow-hidden border-b px-5 pt-24 pb-10 md:px-8 md:pt-28 md:pb-14'>
      <div
        aria-hidden='true'
        className='border-border/25 pointer-events-none absolute inset-y-0 left-1/2 hidden w-px border-l lg:block'
      />
      <div className='mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[0.96fr_1.04fr] lg:gap-16'>
        <div className='relative z-10'>
          <p
            className='landing-animate-fade-up text-primary text-xs font-semibold tracking-[0.14em] uppercase opacity-0'
            style={{ animationDelay: '0ms' }}
          >
            {t('One API key. A deliberate choice of models.')}
          </p>
          <h1
            className='landing-animate-fade-up mt-5 max-w-xl font-serif text-6xl leading-[0.92] font-semibold opacity-0 sm:text-7xl md:text-8xl'
            style={{ animationDelay: '70ms' }}
          >
            VL <span className='text-muted-foreground'>API</span>
          </h1>
          <p
            className='landing-animate-fade-up text-muted-foreground mt-7 max-w-lg text-base leading-7 opacity-0 md:text-lg'
            style={{ animationDelay: '140ms' }}
          >
            {t(
              'A single gateway for AI models: connect once, switch providers without rewriting the client, and pay only for actual usage.'
            )}
          </p>

          <div
            className='landing-animate-fade-up mt-8 flex flex-wrap gap-3 opacity-0'
            style={{ animationDelay: '210ms' }}
          >
            <Button
              size='lg'
              render={
                <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
              }
            >
              {props.isAuthenticated
                ? t('Go to Dashboard')
                : t('Get an API key')}
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon='inline-end' />
            </Button>
            <Button variant='outline' size='lg' render={<Link to='/pricing' />}>
              {t('Models and pricing')}
            </Button>
            <Button
              variant='ghost'
              size='lg'
              render={
                isExternalDocs ? (
                  <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
                ) : (
                  <Link to={docsUrl} />
                )
              }
            >
              <HugeiconsIcon icon={BookOpen01Icon} data-icon='inline-start' />
              {t('Docs')}
            </Button>
          </div>

          <div
            className='landing-animate-fade-up border-border/60 mt-9 flex max-w-xl flex-wrap gap-x-6 gap-y-3 border-t pt-5 text-xs opacity-0'
            style={{ animationDelay: '280ms' }}
          >
            {[
              t('OpenAI-compatible endpoint'),
              t('Transparent usage history'),
              t('Live service metrics'),
            ].map((item) => (
              <span key={item} className='flex items-center gap-2'>
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  className='text-primary size-4'
                />
                {item}
              </span>
            ))}
          </div>
        </div>

        <div
          className='landing-animate-fade-up relative mx-auto w-full max-w-[25rem] opacity-0 lg:max-w-[30rem]'
          style={{ animationDelay: '180ms' }}
        >
          <FortuneWheel />
          <div className='border-border/60 bg-background/80 absolute top-[20%] -left-3 hidden border px-3 py-2 text-xs backdrop-blur sm:block'>
            <span className='text-muted-foreground'>POST</span>{' '}
            <span className='font-mono'>/v1/responses</span>
          </div>
          <div className='border-border/60 bg-background/80 absolute right-0 bottom-[21%] hidden border px-3 py-2 text-xs backdrop-blur sm:block'>
            <span className='text-primary'>●</span>{' '}
            <span>{t('Route available')}</span>
          </div>
        </div>
      </div>

      <div className='text-muted-foreground mx-auto mt-6 flex max-w-6xl items-center justify-center gap-4 border-t border-dotted pt-5 font-serif text-xs sm:gap-8 sm:text-sm'>
        <span>OpenAI</span>
        <span>Claude</span>
        <span>Gemini</span>
        <span>Grok</span>
        <span className='hidden sm:inline'>DeepSeek</span>
      </div>
    </section>
  )
}
