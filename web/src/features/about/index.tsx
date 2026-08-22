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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  BookOpen,
  CircleDollarSign,
  KeyRound,
  Route,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { isHttpUrl, isLikelyHtml } from '@/lib/content-format'

import { getAboutContent } from './api'

export function DefaultAboutContent() {
  const { t } = useTranslation()
  const currentYear = new Date().getFullYear()
  const principles = [
    {
      icon: KeyRound,
      title: t('One entry point'),
      description: t(
        'Use one API key for the models and applications you already know.'
      ),
    },
    {
      icon: Route,
      title: t('Visible routing'),
      description: t(
        'Choose where requests go and keep control of the model group behind the endpoint.'
      ),
    },
    {
      icon: CircleDollarSign,
      title: t('Understandable spending'),
      description: t(
        'Balance, request history and model pricing stay close to the work itself.'
      ),
    },
  ]

  return (
    <div className='vl-public-surface px-1 pt-8 pb-16 sm:px-4 md:pt-16 md:pb-24'>
      <section className='border-border/60 mx-auto grid max-w-6xl gap-10 border-b pb-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-end'>
        <div>
          <p className='text-primary text-xs font-semibold tracking-[0.14em] uppercase'>
            {t('About VL')}
          </p>
          <h1 className='mt-4 font-serif text-6xl leading-none font-semibold md:text-8xl'>
            VL API
          </h1>
        </div>
        <div>
          <p className='text-muted-foreground max-w-2xl text-lg leading-8 md:text-xl'>
            {t(
              'A practical gateway for working with AI models without turning providers, keys and usage into separate systems.'
            )}
          </p>
          <div className='mt-7 flex flex-wrap gap-3'>
            <Button render={<Link to='/pricing' />}>
              {t('Explore models')}
            </Button>
            <Button variant='outline' render={<Link to='/docs' />}>
              <BookOpen data-icon='inline-start' />
              {t('Open documentation')}
            </Button>
          </div>
        </div>
      </section>

      <section className='mx-auto max-w-6xl py-16 md:py-24'>
        <div className='grid gap-8 lg:grid-cols-[0.72fr_1.28fr]'>
          <div>
            <p className='text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase'>
              {t('Our approach')}
            </p>
            <h2 className='mt-4 max-w-sm font-serif text-4xl leading-tight font-semibold md:text-5xl'>
              {t('Less ceremony between an idea and its first request.')}
            </h2>
          </div>
          <div className='border-border/60 border-y'>
            {principles.map((principle) => (
              <div
                key={principle.title}
                className='border-border/60 grid gap-4 border-b py-7 last:border-b-0 sm:grid-cols-[3rem_0.75fr_1.25fr] sm:items-center sm:gap-6'
              >
                <principle.icon className='text-primary size-5' />
                <h3 className='font-serif text-lg font-semibold'>
                  {principle.title}
                </h3>
                <p className='text-muted-foreground text-sm leading-6'>
                  {principle.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className='border-border/60 bg-muted/15 mx-auto max-w-6xl border px-6 py-8 md:px-10'>
        <div className='grid gap-8 md:grid-cols-[1fr_auto] md:items-center'>
          <div>
            <p className='font-serif text-xl font-semibold'>
              {t('Built on an open foundation')}
            </p>
            <p className='text-muted-foreground mt-2 max-w-2xl text-sm leading-6'>
              {t(
                'VL uses New API as its open-source foundation and keeps the original project attribution and license available here.'
              )}
            </p>
          </div>
          <Button
            variant='outline'
            render={
              <a
                href='https://github.com/QuantumNous/new-api'
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            {t('Source project')}
            <ArrowUpRight data-icon='inline-end' />
          </Button>
        </div>
        <div className='border-border/60 text-muted-foreground mt-7 flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-xs'>
          <span>
            {t('New API Project Repository:')}{' '}
            <a
              href='https://github.com/QuantumNous/new-api'
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground hover:underline'
            >
              github.com/QuantumNous/new-api
            </a>
          </span>
          <span>
            New API © {currentYear}{' '}
            <a
              href='https://github.com/QuantumNous'
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground hover:underline'
            >
              {t('QuantumNous')}
            </a>
          </span>
          <span>
            {t('This project must be used in compliance with the')}{' '}
            <a
              href='https://github.com/QuantumNous/new-api/blob/main/LICENSE'
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground hover:underline'
            >
              {t('AGPL v3.0 License')}
            </a>
            .
          </span>
        </div>
      </section>
    </div>
  )
}

export function About() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['about-content'],
    queryFn: getAboutContent,
  })

  const rawContent = data?.data?.trim() ?? ''
  const hasContent = rawContent.length > 0
  const isUrl = hasContent && isHttpUrl(rawContent)
  const contentIsHtml = hasContent && isLikelyHtml(rawContent)

  if (isLoading) {
    return (
      <PublicLayout>
        <div className='mx-auto flex max-w-4xl flex-col gap-4 py-12'>
          <Skeleton className='h-8 w-[45%]' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-[90%]' />
          <Skeleton className='h-4 w-[80%]' />
        </div>
      </PublicLayout>
    )
  }

  if (!hasContent) {
    return (
      <PublicLayout>
        <DefaultAboutContent />
      </PublicLayout>
    )
  }

  if (isUrl) {
    return (
      <PublicLayout showMainContainer={false}>
        <iframe
          src={rawContent}
          className='h-[calc(100vh-3.5rem)] w-full border-0'
          title={t('About')}
          sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts'
        />
      </PublicLayout>
    )
  }

  if (contentIsHtml) {
    return (
      <PublicLayout showMainContainer={false}>
        <RichContent
          mode='html'
          htmlVariant='isolated'
          content={rawContent}
          className='prose-neutral dark:prose-invert max-w-none'
        />
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <div className='mx-auto max-w-6xl px-4 py-8'>
        <RichContent
          mode='markdown'
          content={rawContent}
          className='prose-neutral dark:prose-invert max-w-none'
        />
      </div>
    </PublicLayout>
  )
}
