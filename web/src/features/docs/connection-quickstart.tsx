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
import { GraduationCap, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useConnectionTour } from '@/features/onboarding/store'
import { useAuthStore } from '@/stores/auth-store'

export function ConnectionQuickstart() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const steps = [
    {
      title: t('Create API Key'),
      text: t(
        'Open API Keys in the console, click Create API Key, give it a name, and save. Keep the key private.'
      ),
    },
    {
      title: t('Connect'),
      text: t(
        'Find your key in the list and click Connect on its row. This opens the client setup window; you do not need to search the three-dot menu.'
      ),
    },
    {
      title: t('Choose your application'),
      text: t(
        'For Claude Code, Codex, or Gemini CLI, install CC Switch, choose the application and an available primary model, then click Open CC Switch and confirm the import there.'
      ),
    },
    {
      title: t('Send a test message'),
      text: t(
        'Make sure your wallet has credits, open the configured client, and send a short message. Check Usage Logs to confirm the request. Importing settings alone does not verify the connection.'
      ),
    },
  ]

  return (
    <section
      aria-labelledby='connection-quickstart-title'
      className='flex flex-col gap-6 border-b py-10'
    >
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='flex max-w-2xl flex-col gap-2'>
          <h2
            id='connection-quickstart-title'
            className='font-serif text-2xl font-semibold'
          >
            {t('First connection, step by step')}
          </h2>
          <p className='text-muted-foreground text-sm leading-6'>
            {t(
              'The Connect button next to your API key is the quickest way to set up a client.'
            )}
          </p>
        </div>
        <Button
          render={<Link to='/keys' />}
          onClick={() => {
            if (user) useConnectionTour.getState().showWelcome(user.id)
          }}
        >
          <GraduationCap aria-hidden='true' />
          {t('Start interactive tutorial')}
          <ArrowRight aria-hidden='true' />
        </Button>
      </div>
      <ol className='grid gap-4 md:grid-cols-2'>
        {steps.map((step, index) => (
          <li
            key={step.title}
            className='bg-card flex gap-4 rounded-xl border p-5'
          >
            <span
              aria-hidden='true'
              className='bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-full font-mono text-sm'
            >
              {index + 1}
            </span>
            <div className='flex min-w-0 flex-col gap-2'>
              <h3 className='font-semibold'>{step.title}</h3>
              <p className='text-muted-foreground text-sm leading-6'>
                {step.text}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className='text-muted-foreground text-sm leading-6'>
        {t(
          'Using another client or no CC Switch? Follow the manual setup below: copy your API key and the API address into the client settings. Never use your account password as an API key.'
        )}
      </p>
      <p className='text-muted-foreground text-sm leading-6'>
        {t(
          'You can replay the tutorial from the Connection tutorial button in the console header or from this page.'
        )}
      </p>
    </section>
  )
}
