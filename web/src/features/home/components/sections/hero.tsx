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
  Activity02Icon,
  ArrowRight01Icon,
  BadgeCheckIcon,
  BookOpen01Icon,
  BracesIcon,
  CircleDollarSignIcon,
  SecurityCheckIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { CherryStudio } from '@lobehub/icons'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useStatus } from '@/hooks/use-status'

import { HeroTerminalDemo } from '../hero-terminal-demo'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'

  const renderDocsButton = () => {
    const isExternal = docsUrl.startsWith('http')
    const content = (
      <>
        <HugeiconsIcon icon={BookOpen01Icon} data-icon='inline-start' />
        <span>{t('Docs')}</span>
      </>
    )

    if (isExternal) {
      return (
        <Button
          variant='outline'
          size='lg'
          render={
            <a href={docsUrl} target='_blank' rel='noopener noreferrer' />
          }
        >
          {content}
        </Button>
      )
    }

    return (
      <Button variant='outline' size='lg' render={<Link to={docsUrl} />}>
        {content}
      </Button>
    )
  }

  return (
    <section className='border-border/60 bg-background relative z-10 overflow-hidden border-b px-6 pt-20 pb-0 md:pt-28 lg:pt-32'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] bg-[size:3.5rem_3.5rem] opacity-40 dark:opacity-20'
      />

      <div className='mx-auto max-w-6xl'>
        <div className='grid items-center gap-12 lg:grid-cols-[minmax(0,0.94fr)_minmax(27rem,1.06fr)] lg:gap-16'>
          <div className='flex flex-col items-start text-left'>
            <Badge
              variant='outline'
              className='landing-animate-fade-up mb-7 h-auto max-w-full gap-2 px-3 py-1.5 text-[9px] tracking-[0.06em] whitespace-normal uppercase opacity-0 sm:text-[11px] sm:tracking-[0.08em]'
              style={{ animationDelay: '0ms' }}
            >
              <HugeiconsIcon icon={Activity02Icon} className='size-3.5' />
              <span>{t('AI Application Infrastructure Foundation')}</span>
            </Badge>

            <h1
              className='landing-animate-fade-up max-w-xl font-serif text-[clamp(2.05rem,4.25vw,3.75rem)] leading-[1.02] font-semibold tracking-normal opacity-0'
              style={{ animationDelay: '60ms' }}
            >
              {t('Unified API Gateway for')}
              <br />
              <span className='text-primary'>
                {t('Vast Range of AI Models')}
              </span>
            </h1>

            <p
              className='landing-animate-fade-up text-muted-foreground mt-7 max-w-lg text-base leading-relaxed opacity-0 md:text-[17px]'
              style={{ animationDelay: '120ms' }}
            >
              {t(
                'Access a vast selection of models via a standard, unified API protocol. Power AI applications, manage digital assets, and connect the Future.'
              )}
            </p>

            <div
              className='landing-animate-fade-up mt-9 flex flex-wrap items-center gap-3 opacity-0'
              style={{ animationDelay: '180ms' }}
            >
              {props.isAuthenticated ? (
                <>
                  <Button size='lg' render={<Link to='/dashboard' />}>
                    {t('Go to Dashboard')}
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      data-icon='inline-end'
                      className='transition-transform group-hover/button:translate-x-0.5'
                    />
                  </Button>
                  {renderDocsButton()}
                </>
              ) : (
                <>
                  <Button size='lg' render={<Link to='/sign-up' />}>
                    {t('Get Started')}
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      data-icon='inline-end'
                      className='transition-transform group-hover/button:translate-x-0.5'
                    />
                  </Button>
                  <Button
                    variant='outline'
                    size='lg'
                    render={<Link to='/pricing' />}
                  >
                    {t('View Pricing')}
                  </Button>
                  {renderDocsButton()}
                </>
              )}
            </div>

            <div
              className='landing-animate-fade-up border-border/60 mt-12 grid w-full max-w-xl grid-cols-3 border-y opacity-0'
              style={{ animationDelay: '240ms' }}
            >
              <div className='border-border/60 flex min-w-0 flex-col gap-1 border-r py-4 pr-3'>
                <HugeiconsIcon
                  icon={SecurityCheckIcon}
                  className='text-primary size-4'
                />
                <span className='mt-1 text-xs font-semibold'>
                  {t('Secure & Reliable')}
                </span>
              </div>
              <div className='border-border/60 flex min-w-0 flex-col gap-1 border-r px-4 py-4'>
                <HugeiconsIcon
                  icon={CircleDollarSignIcon}
                  className='text-primary size-4'
                />
                <span className='mt-1 text-xs font-semibold'>
                  {t('Transparent Billing')}
                </span>
              </div>
              <div className='flex min-w-0 flex-col gap-1 py-4 pl-4'>
                <HugeiconsIcon
                  icon={BracesIcon}
                  className='text-primary size-4'
                />
                <span className='mt-1 text-xs font-semibold'>
                  {t('Multi-protocol Compatible')}
                </span>
              </div>
            </div>
          </div>

          <div
            className='landing-animate-fade-up relative w-full opacity-0'
            style={{ animationDelay: '300ms' }}
          >
            <Badge
              variant='outline'
              className='bg-background absolute -top-5 right-4 z-10 hidden gap-2 px-3 py-2 shadow-sm sm:flex'
            >
              <HugeiconsIcon
                icon={BadgeCheckIcon}
                className='text-primary size-4'
              />
              <span>{t('compatible API routes')}</span>
            </Badge>
            <HeroTerminalDemo className='w-full' />
          </div>
        </div>

        <div className='border-border/60 text-muted-foreground mt-16 flex max-w-6xl items-center gap-4 border-t py-5 text-xs md:mt-20'>
          <span className='text-foreground font-medium'>
            {t('Supported Applications')}
          </span>
          <Separator className='flex-1' />
          <CherryStudio.Color size={20} aria-label='Cherry Studio' />
          <span className='hidden sm:inline'>Cherry Studio</span>
          <Separator orientation='vertical' className='hidden h-4 sm:block' />
          <span className='font-medium'>OpenAI</span>
          <span className='font-medium'>Claude</span>
          <span className='font-medium'>Gemini</span>
        </div>
      </div>
    </section>
  )
}
