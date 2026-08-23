/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  CustomerSupportIcon,
  Mail01Icon,
  TelegramIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

export function Support() {
  const { t } = useTranslation()

  return (
    <PublicLayout>
      <div className='mx-auto max-w-4xl py-10 sm:py-16'>
        <header className='max-w-2xl'>
          <div className='text-primary mb-4 flex items-center gap-2 text-sm font-medium'>
            <HugeiconsIcon icon={CustomerSupportIcon} />
            {t('Support')}
          </div>
          <h1 className='font-serif text-3xl font-semibold sm:text-5xl'>
            {t('Support and contacts')}
          </h1>
          <p className='text-muted-foreground mt-4 text-base leading-7'>
            {t(
              'Contact us directly. We will help with access, payments, and using the API.'
            )}
          </p>
        </header>

        <div className='mt-10 grid gap-3 sm:grid-cols-2'>
          <a
            href='https://t.me/VLTOKENmr'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:bg-muted/30 flex min-w-0 items-center gap-4 rounded-lg border p-5 transition-colors'
          >
            <span className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-md'>
              <HugeiconsIcon icon={TelegramIcon} />
            </span>
            <span className='min-w-0'>
              <span className='block font-medium'>{t('Telegram support')}</span>
              <span className='text-muted-foreground block truncate text-sm'>
                @VLTOKENmr
              </span>
            </span>
          </a>

          <a
            href='mailto:seregaboj619@gmail.com'
            className='hover:bg-muted/30 flex min-w-0 items-center gap-4 rounded-lg border p-5 transition-colors'
          >
            <span className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-md'>
              <HugeiconsIcon icon={Mail01Icon} />
            </span>
            <span className='min-w-0'>
              <span className='block font-medium'>{t('Email support')}</span>
              <span className='text-muted-foreground block truncate text-sm'>
                seregaboj619@gmail.com
              </span>
            </span>
          </a>
        </div>

        <div className='mt-8 flex flex-wrap gap-2'>
          <Button
            render={
              <a
                href='https://t.me/VLTOKENmr'
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            <HugeiconsIcon icon={TelegramIcon} data-icon='inline-start' />
            {t('Write in Telegram')}
          </Button>
          <Button
            variant='outline'
            render={<a href='mailto:seregaboj619@gmail.com' />}
          >
            <HugeiconsIcon icon={Mail01Icon} data-icon='inline-start' />
            {t('Send email')}
          </Button>
        </div>
      </div>
    </PublicLayout>
  )
}
