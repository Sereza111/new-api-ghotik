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
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, CircleDashed, Globe2, Server } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FortuneAtmosphere } from '@/features/home/components/fortune-atmosphere'

import { GothicResellerCards } from './components/gothic-reseller-cards'
import { ResellerConfigurator } from './components/reseller-configurator'
import { ResellerKeyVault } from './components/reseller-key-vault'
import {
  calculateResellerQuote,
  DEFAULT_RESELLER_ENDPOINT,
  normalizeResellerEndpoint,
  resellerDraftSchema,
} from './lib/pricing'
import type { DemoResellerKey, ResellerDraftValues } from './types'

const DEFAULT_DRAFT: ResellerDraftValues = {
  clientLabel: '',
  tokenMillions: 10,
  markupPercent: 80,
  term: 'unlimited',
}

const RESELLER_ENDPOINT_STORAGE_KEY = 'vl-reseller-endpoint'

export function Reseller() {
  const { i18n, t } = useTranslation()
  const [preparedKeys, setPreparedKeys] = useState<DemoResellerKey[]>([])
  const [resellerEndpoint, setResellerEndpoint] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_RESELLER_ENDPOINT
    const stored = window.localStorage.getItem(RESELLER_ENDPOINT_STORAGE_KEY)
    return stored
      ? normalizeResellerEndpoint(stored) || DEFAULT_RESELLER_ENDPOINT
      : DEFAULT_RESELLER_ENDPOINT
  })
  const [endpointDraft, setEndpointDraft] = useState(resellerEndpoint)
  const [endpointError, setEndpointError] = useState(false)
  const form = useForm<ResellerDraftValues>({
    resolver: zodResolver(resellerDraftSchema),
    defaultValues: DEFAULT_DRAFT,
  })
  const tokenMillions = useWatch({
    control: form.control,
    name: 'tokenMillions',
  })
  const markupPercent = useWatch({
    control: form.control,
    name: 'markupPercent',
  })
  const locale = i18n.resolvedLanguage || 'en'
  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
      }),
    [locale]
  )
  const formatMoney = useCallback(
    (value: number) => moneyFormatter.format(value),
    [moneyFormatter]
  )
  const quote = calculateResellerQuote(tokenMillions, markupPercent)

  const handleEndpointSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizeResellerEndpoint(endpointDraft)
    if (!normalized) {
      setEndpointError(true)
      toast.error(t('Enter a valid HTTP(S) address.'))
      return
    }

    setResellerEndpoint(normalized)
    setEndpointDraft(normalized)
    setEndpointError(false)
    window.localStorage.setItem(RESELLER_ENDPOINT_STORAGE_KEY, normalized)
    toast.success(t('Setting saved'))
  }

  const handlePrepareKey = (values: ResellerDraftValues) => {
    const keyNumber = preparedKeys.length + 1
    const clientLabel =
      values.clientLabel.trim() ||
      t('Client key {{number}}', { number: keyNumber })
    const preparedQuote = calculateResellerQuote(
      values.tokenMillions,
      values.markupPercent
    )

    setPreparedKeys((current) => [
      {
        ...values,
        ...preparedQuote,
        clientLabel,
        id: nanoid(),
        key: `sk-vl-demo-${nanoid(18)}`,
        endpoint: resellerEndpoint,
      },
      ...current,
    ])
    toast.success(t('Demo key prepared'))
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Reseller')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Badge variant='outline' className='gap-1.5'>
          <CircleDashed aria-hidden='true' />
          {t('Preview mode')}
        </Badge>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='reseller-page-surface mx-auto w-full max-w-7xl'>
          <FortuneAtmosphere />
          <div className='reseller-page-content flex flex-col gap-8'>
            <section className='reseller-intro-band'>
              <div className='max-w-3xl'>
                <p className='text-primary text-xs font-semibold uppercase'>
                  {t('Reseller workspace')}
                </p>
                <h2 className='mt-3 font-serif text-2xl leading-tight font-semibold sm:text-3xl'>
                  {t('Issue quota keys for your clients')}
                </h2>
                <p className='text-muted-foreground mt-3 max-w-2xl text-sm leading-6'>
                  {t(
                    'Client usage is deducted from the key quota: input, output, and cache tokens.'
                  )}
                </p>
              </div>

              <div className='reseller-endpoint-panel'>
                <div className='flex items-center gap-2'>
                  <Globe2 className='text-primary size-4' aria-hidden='true' />
                  <label
                    htmlFor='reseller-endpoint'
                    className='text-sm font-medium'
                  >
                    {t('Reseller endpoint')}
                  </label>
                  <Badge variant='secondary' className='ms-auto'>
                    {t('Editable')}
                  </Badge>
                </div>
                <form
                  className='mt-3 flex min-w-0 items-start gap-2'
                  onSubmit={handleEndpointSubmit}
                >
                  <Input
                    id='reseller-endpoint'
                    type='text'
                    value={endpointDraft}
                    autoComplete='url'
                    aria-invalid={endpointError}
                    aria-describedby={
                      endpointError ? 'reseller-endpoint-error' : undefined
                    }
                    onChange={(event) => {
                      setEndpointDraft(event.target.value)
                      if (endpointError) setEndpointError(false)
                    }}
                  />
                  <Button type='submit' size='sm' className='shrink-0'>
                    <Check data-icon='inline-start' />
                    {t('Save')}
                  </Button>
                </form>
                {endpointError ? (
                  <p
                    id='reseller-endpoint-error'
                    className='text-destructive mt-2 text-xs'
                    role='alert'
                  >
                    {t('Enter a valid HTTP(S) address.')}
                  </p>
                ) : null}
                <div className='bg-background/70 mt-2 flex min-w-0 items-center gap-2 rounded-md border py-1.5 ps-3 pe-1.5'>
                  <Server
                    className='text-muted-foreground size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <code className='min-w-0 flex-1 truncate text-xs'>
                    {resellerEndpoint}
                  </code>
                  <CopyButton
                    value={resellerEndpoint}
                    tooltip={t('Copy endpoint')}
                    aria-label={t('Copy endpoint')}
                  />
                </div>
                <p className='text-muted-foreground mt-2 text-xs leading-5'>
                  {t('Address used in prepared keys.')}
                </p>
              </div>
            </section>

            <section aria-labelledby='reseller-packages-title'>
              <div className='mb-4 flex flex-wrap items-end justify-between gap-3'>
                <div>
                  <h3
                    id='reseller-packages-title'
                    className='font-serif text-xl font-semibold'
                  >
                    {t('Token packages')}
                  </h3>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {t('Select a preset or enter any amount from 1M tokens.')}
                  </p>
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t('Base cost')}: {formatMoney(0.12)} / 1M
                </p>
              </div>

              <GothicResellerCards
                tokenMillions={tokenMillions}
                markupPercent={markupPercent}
                formatMoney={formatMoney}
                onSelect={(nextTokenMillions) => {
                  form.setValue('tokenMillions', nextTokenMillions, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
              />
            </section>

            <div className='grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]'>
              <ResellerConfigurator
                form={form}
                quote={quote}
                formatMoney={formatMoney}
                onSubmit={handlePrepareKey}
              />
              <ResellerKeyVault keys={preparedKeys} formatMoney={formatMoney} />
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
