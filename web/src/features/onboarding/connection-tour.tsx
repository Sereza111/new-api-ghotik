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
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowRight,
  GraduationCap,
  KeyRound,
  Link2,
  MessageCircle,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import '@/styles/onboarding.css'

import { ConnectionSpotlight } from './connection-spotlight'
import { useConnectionTour } from './store'

export function ConnectionTour() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const onKeysPage = useRouterState({
    select: (state) => /^\/keys\/?$/.test(state.location.pathname),
  })
  const user = useAuthStore((state) => state.auth.user)
  const tourUserId = useConnectionTour((state) => state.userId)
  const phase = useConnectionTour((state) => state.phase)
  const initialize = useConnectionTour((state) => state.initialize)
  const dismiss = useConnectionTour((state) => state.dismiss)
  const start = useConnectionTour((state) => state.start)

  useEffect(() => {
    const synchronizeIdentity = () => {
      const current = useAuthStore.getState().auth.user
      initialize(
        current?.id ?? null,
        current?.request_count,
        current?.role ?? 0
      )
    }
    synchronizeIdentity()
    return useAuthStore.subscribe((state, previous) => {
      if (state.auth.user !== previous.auth.user) synchronizeIdentity()
    })
  }, [initialize])

  useEffect(() => {
    if (!onKeysPage && (phase.startsWith('manual-') || phase === 'verify')) {
      useConnectionTour.getState().connectionClosed()
    }
  }, [onKeysPage, phase])

  if (!user || tourUserId !== user.id) return null
  if (phase !== 'idle' && phase !== 'welcome' && onKeysPage) {
    return <ConnectionSpotlight phase={phase} />
  }
  return (
    <Dialog
      open={phase === 'welcome'}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
      title={t('Your first connection, together')}
      description={t('Follow the highlights. One click at a time.')}
      showCloseButton={false}
      contentClassName='connection-tour-welcome sm:max-w-lg'
      titleClassName='font-serif text-3xl leading-tight'
      descriptionClassName='text-base'
      footer={
        <>
          <Button variant='ghost' onClick={dismiss}>
            {t('Maybe later')}
          </Button>
          <Button
            size='lg'
            onClick={async () => {
              await navigate({ to: '/keys' })
              start()
            }}
          >
            {t('Show me how')}
            <ArrowRight aria-hidden='true' />
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-6 py-3'>
        <div
          aria-hidden='true'
          className='bg-primary/10 text-primary flex h-24 items-center justify-center gap-5 rounded-lg'
        >
          <KeyRound className='size-8' />
          <ArrowRight className='size-4 opacity-50' />
          <Link2 className='size-8' />
          <ArrowRight className='size-4 opacity-50' />
          <MessageCircle className='size-8' />
        </div>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'We will copy your key and API address, choose a model, and enter the settings in your app manually.'
          )}
        </p>
      </div>
    </Dialog>
  )
}

export function ConnectionTutorialButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)
  const phase = useConnectionTour((state) => state.phase)
  const tourUserId = useConnectionTour((state) => state.userId)
  const showWelcome = useConnectionTour((state) => state.showWelcome)
  if (!user) return null
  const active =
    tourUserId === user.id && phase !== 'idle' && phase !== 'welcome'
  return (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size='icon'
      className='min-[1600px]:w-auto min-[1600px]:gap-1.5 min-[1600px]:px-2.5'
      aria-label={
        active ? t('Continue connection tutorial') : t('Connection tutorial')
      }
      title={t('Connection tutorial')}
      onClick={() => {
        if (active) void navigate({ to: '/keys' })
        else showWelcome(user.id)
      }}
    >
      <GraduationCap aria-hidden='true' />
      <span className='hidden min-[1600px]:inline'>
        {t('Connection tutorial')}
      </span>
    </Button>
  )
}
