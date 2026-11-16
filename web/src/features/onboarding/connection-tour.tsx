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
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  PlugZap,
  Rocket,
} from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { useConnectionTour } from './store'

export function ConnectionTour() {
  const { t } = useTranslation()
  const navigate = useNavigate()
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

  const steps = [
    {
      icon: KeyRound,
      title: t('Create your API key'),
      description: t('We will show you the exact button and the key settings.'),
    },
    {
      icon: PlugZap,
      title: t('Connect your app'),
      description: t('Use Connect beside your key to open the client setup.'),
    },
    {
      icon: CheckCircle2,
      title: t('Try your first request'),
      description: t(
        'Send a short message in your app and check that it responds.'
      ),
    },
  ]

  return (
    <Dialog
      open={Boolean(user && tourUserId === user.id && phase === 'welcome')}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
      title={t('Let us connect your first app')}
      description={t(
        'A short walkthrough on the real screens. You can stop at any time and replay it from Connection tutorial.'
      )}
      footer={
        <>
          <Button variant='ghost' onClick={dismiss}>
            {t('Maybe later')}
          </Button>
          <Button
            onClick={async () => {
              await navigate({ to: '/keys' })
              start()
            }}
          >
            {t('Start walkthrough')}
            <ArrowRight aria-hidden='true' />
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-5'>
        <div className='bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl'>
          <Rocket className='size-6' aria-hidden='true' />
        </div>
        <ol className='flex flex-col gap-4'>
          {steps.map((step) => (
            <li key={step.title} className='flex items-start gap-3'>
              <step.icon
                className='text-primary mt-0.5 size-5 shrink-0'
                aria-hidden='true'
              />
              <div>
                <p className='font-medium'>{step.title}</p>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
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
    tourUserId === user.id && ['keys', 'connect', 'verify'].includes(phase)
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
      <PlugZap aria-hidden='true' />
      <span className='hidden min-[1600px]:inline'>
        {t('Connection tutorial')}
      </span>
    </Button>
  )
}
