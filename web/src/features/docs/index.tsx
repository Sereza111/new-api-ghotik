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
import { ArrowRight, BookOpen, KeyRound, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { PublicLayout } from '@/components/layout/components/public-layout'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const ENDPOINTS = [
  'POST /v1/chat/completions',
  'POST /v1/responses',
  'GET /v1/models',
  'POST /v1/embeddings',
  'POST /v1/images/generations',
] as const

export function Docs() {
  const { t } = useTranslation()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const baseUrl = `${origin}/v1`
  const curlExample = `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-key" \\
  -d '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"Hello"}]}'`

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-24 pb-14 sm:px-6 lg:px-8'>
        <header className='flex max-w-3xl flex-col gap-4'>
          <Badge variant='outline' className='gap-1.5'>
            <BookOpen data-icon='inline-start' />
            {t('API Documentation')}
          </Badge>
          <h1 className='font-serif text-4xl font-semibold sm:text-5xl'>
            {t('Connect in a few minutes')}
          </h1>
          <p className='text-muted-foreground max-w-2xl text-base leading-7'>
            {t(
              'Use one API key and an OpenAI-compatible base URL in your application.'
            )}
          </p>
        </header>

        <section className='bg-border grid gap-px overflow-hidden rounded-md border lg:grid-cols-3'>
          <DocStep
            number='01'
            title={t('Create an API key')}
            description={t(
              'Create a key in the console and set a spending limit.'
            )}
            icon={KeyRound}
          />
          <DocStep
            number='02'
            title={t('Set the base URL')}
            description={baseUrl}
            icon={Terminal}
          />
          <DocStep
            number='03'
            title={t('Send your first request')}
            description={t(
              'Choose a model from the catalog and make a request.'
            )}
            icon={ArrowRight}
          />
        </section>

        <section className='grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]'>
          <div className='flex min-w-0 flex-col gap-4'>
            <div>
              <h2 className='font-serif text-2xl font-semibold'>
                {t('First request')}
              </h2>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t('Replace the example key and model with your own values.')}
              </p>
            </div>
            <div className='bg-card relative overflow-x-auto rounded-md border p-4 pr-12'>
              <pre className='font-mono text-xs leading-6 whitespace-pre sm:text-sm'>
                <code>{curlExample}</code>
              </pre>
              <CopyButton
                value={curlExample}
                className='absolute top-2 right-2'
                tooltip={t('Copy request')}
              />
            </div>
          </div>

          <aside className='flex flex-col gap-3'>
            <h2 className='font-serif text-lg font-semibold'>
              {t('Common endpoints')}
            </h2>
            <div className='flex flex-col rounded-md border'>
              {ENDPOINTS.map((endpoint, index) => (
                <div key={endpoint}>
                  {index > 0 && <Separator />}
                  <code className='block px-3 py-2.5 text-xs'>{endpoint}</code>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <section className='flex flex-col items-start justify-between gap-4 border-t pt-8 sm:flex-row sm:items-center'>
          <div>
            <h2 className='font-serif text-xl font-semibold'>
              {t('Ready to connect?')}
            </h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              {t('Create a key, choose a model, and start sending requests.')}
            </p>
          </div>
          <div className='flex gap-2'>
            <Button variant='outline' render={<Link to='/pricing' />}>
              {t('Models')}
            </Button>
            <Button render={<Link to='/keys' />}>
              {t('Create API Key')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </div>
        </section>
      </PageTransition>
    </PublicLayout>
  )
}

type DocStepProps = {
  number: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

function DocStep(props: DocStepProps) {
  const Icon = props.icon
  return (
    <div className='bg-background flex min-h-36 flex-col gap-4 p-5'>
      <div className='flex items-center justify-between'>
        <Icon className='text-primary size-5' aria-hidden='true' />
        <span className='text-muted-foreground font-mono text-xs'>
          {props.number}
        </span>
      </div>
      <div className='min-w-0'>
        <h2 className='font-serif text-base font-semibold'>{props.title}</h2>
        <p className='text-muted-foreground mt-1 truncate text-sm'>
          {props.description}
        </p>
      </div>
    </div>
  )
}
