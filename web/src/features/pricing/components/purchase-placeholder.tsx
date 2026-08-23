/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  CreditCardIcon,
  Mail01Icon,
  TelegramIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type PurchasePlaceholderProps = {
  modelName: string
  className?: string
  size?: 'xs' | 'sm' | 'default' | 'lg'
}

export function PurchasePlaceholder(props: PurchasePlaceholderProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        size={props.size ?? 'sm'}
        className={cn(props.className)}
        aria-label={t('Pay for {{model}}', { model: props.modelName })}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <HugeiconsIcon icon={CreditCardIcon} data-icon='inline-start' />
        {t('Pay')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent onClick={(event) => event.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>
                {t('Purchase {{model}}', { model: props.modelName })}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'The selected model and its current prices are shown on this page. Online payment will become available after payment provider approval.'
                )}
              </DialogDescription>
            </DialogHeader>

            <div className='bg-muted/40 rounded-md border px-3 py-2'>
              <span className='text-muted-foreground block text-xs'>
                {t('Selected model')}
              </span>
              <span className='mt-1 block font-mono font-medium break-all'>
                {props.modelName}
              </span>
            </div>

            <DialogFooter>
              <Button
                variant='outline'
                render={<a href='mailto:seregaboj619@gmail.com' />}
              >
                <HugeiconsIcon icon={Mail01Icon} data-icon='inline-start' />
                {t('Email')}
              </Button>
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
                {t('Telegram')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
