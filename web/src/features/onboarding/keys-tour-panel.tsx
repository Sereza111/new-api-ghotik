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
import { Check, KeyRound, PlugZap, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useConnectionTour } from './store'

export function KeysTourPanel() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const tourUserId = useConnectionTour((state) => state.userId)
  const phase = useConnectionTour((state) => state.phase)
  const dismiss = useConnectionTour((state) => state.dismiss)
  const finish = useConnectionTour((state) => state.finish)
  if (userId !== tourUserId || phase === 'idle' || phase === 'welcome') {
    return null
  }

  const steps = [
    { phase: 'keys', title: t('Create your API key'), icon: KeyRound },
    { phase: 'connect', title: t('Connect your app'), icon: PlugZap },
    { phase: 'verify', title: t('Try your first request'), icon: Send },
  ]
  const index = steps.findIndex((step) => step.phase === phase)
  let description = t(
    'Click Create API Key above. Give it a name, review its limits, then save. If you already have an active key, we will use it for the next step.'
  )
  if (phase === 'connect') {
    description = t(
      'Click Connect beside the key you want to use. This opens CC Switch setup; there is no need to search through the row menu.'
    )
  }
  if (phase === 'verify') {
    description = t(
      'In the setup window, choose your app and model, then open CC Switch to import the configuration. Send a short message in your app. Opening the setup window alone does not verify the connection.'
    )
  }

  return (
    <Card
      size='sm'
      className='mb-4 max-h-[45svh] shrink-0 overflow-y-auto'
      role='region'
      aria-label={t('Connection tutorial')}
    >
      <CardHeader>
        <CardTitle>{t('Connection tutorial')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <ol className='grid grid-cols-3 gap-2' aria-label={t('Setup steps')}>
          {steps.map((step, stepIndex) => (
            <li
              key={step.phase}
              aria-current={stepIndex === index ? 'step' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-center text-xs sm:flex-row sm:gap-2 sm:px-3 sm:text-start',
                stepIndex === index && 'border-primary bg-primary/10',
                stepIndex > index && 'text-muted-foreground'
              )}
            >
              {stepIndex < index ? (
                <Check className='size-4 shrink-0' aria-hidden='true' />
              ) : (
                <step.icon className='size-4 shrink-0' aria-hidden='true' />
              )}
              {step.title}
            </li>
          ))}
        </ol>
        <p className='text-sm leading-6' aria-live='polite'>
          {description}
        </p>
        {phase === 'verify' && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'If the request fails, check your balance and Usage Logs. For manual setup, follow the documentation.'
            )}
          </p>
        )}
      </CardContent>
      <CardFooter className='flex flex-wrap gap-2'>
        <Button size='sm' variant='ghost' onClick={dismiss}>
          {t('Stop tutorial')}
        </Button>
        {phase === 'verify' && (
          <>
            <Button size='sm' variant='outline' render={<Link to='/wallet' />}>
              {t('Wallet')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              render={<Link to='/usage-logs' />}
            >
              {t('Usage Logs')}
            </Button>
            <Button size='sm' variant='outline' render={<Link to='/docs' />}>
              {t('Documentation')}
            </Button>
            <Button size='sm' onClick={finish}>
              {t('I received a response')}
            </Button>
          </>
        )}
      </CardFooter>
    </Card>
  )
}
