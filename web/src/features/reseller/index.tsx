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
import { CircleAlert, Globe2, RefreshCw, Server } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { FortuneAtmosphere } from '@/features/home/components/fortune-atmosphere'

import { GothicResellerCards } from './components/gothic-reseller-cards'
import { ResellerConfigurator } from './components/reseller-configurator'
import { ResellerKeyVault } from './components/reseller-key-vault'
import {
  useCreateResellerKey,
  useResellerConfig,
  useResellerKeys,
  useRevealResellerKey,
} from './hooks/use-reseller'
import {
  calculateResellerQuote,
  DEFAULT_RESELLER_ENDPOINT,
  RESELLER_BASE_COST_PER_MILLION,
  resellerDraftSchema,
} from './lib/pricing'
import type { ResellerDraftValues } from './types'

const DEFAULT_DRAFT: ResellerDraftValues = {
  clientLabel: '',
  tokenMillions: 10,
  markupPercent: 80,
  term: 'unlimited',
}

const PACKAGE_SKELETON_IDS = [
  'package-1',
  'package-2',
  'package-3',
  'package-4',
]
const FORM_SKELETON_IDS = ['field-1', 'field-2', 'field-3', 'field-4']

export function Reseller() {
  const { i18n, t } = useTranslation()
  const configQuery = useResellerConfig()
  const keysQuery = useResellerKeys()
  const createKeyMutation = useCreateResellerKey()
  const revealKeyMutation = useRevealResellerKey()
  const pendingIssueRequest = useRef<{
    id: string
    fingerprint: string
  } | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({})
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
  const baseCostPerMillion =
    configQuery.data?.base_cost_per_million ?? RESELLER_BASE_COST_PER_MILLION
  const configuredEndpoint =
    configQuery.data?.default_endpoint || DEFAULT_RESELLER_ENDPOINT
  const revealingKeyId = revealKeyMutation.isPending
    ? revealKeyMutation.variables
    : null
  const quote = calculateResellerQuote(
    tokenMillions,
    markupPercent,
    baseCostPerMillion
  )

  const handleIssueKey = async (values: ResellerDraftValues) => {
    const keyNumber = (keysQuery.data?.length ?? 0) + 1
    const clientLabel =
      values.clientLabel.trim() ||
      t('Client key {{number}}', { number: keyNumber })

    const requestPayload = {
      client_label: clientLabel,
      token_millions: values.tokenMillions,
      markup_percent: values.markupPercent,
      term: values.term,
    }
    const fingerprint = JSON.stringify(requestPayload)
    let issueRequest = pendingIssueRequest.current
    if (issueRequest?.fingerprint !== fingerprint) {
      issueRequest = {
        id: crypto.randomUUID(),
        fingerprint,
      }
      pendingIssueRequest.current = issueRequest
    }

    try {
      const createdKey = await createKeyMutation.mutateAsync({
        ...requestPayload,
        request_id: issueRequest.id,
      })

      pendingIssueRequest.current = null
      setRevealedKeys((current) => ({
        ...current,
        [createdKey.id]: createdKey.key,
      }))
      form.reset({ ...values, clientLabel: '' })
      toast.success(t('Reseller key issued'))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? t(error.message)
          : t('Failed to issue reseller key')
      )
    }
  }

  const handleRevealKey = async (id: number) => {
    try {
      const key = await revealKeyMutation.mutateAsync(id)
      setRevealedKeys((current) => ({ ...current, [id]: key }))
    } catch (error) {
      toast.error(
        error instanceof Error ? t(error.message) : t('Failed to reveal key')
      )
    }
  }

  let packageContent: ReactNode
  if (configQuery.isPending) {
    packageContent = (
      <div
        className='grid grid-cols-2 gap-3 lg:grid-cols-4'
        aria-label={t('Loading reseller pricing')}
      >
        {PACKAGE_SKELETON_IDS.map((id) => (
          <Skeleton key={id} className='aspect-[310/735] w-full rounded-none' />
        ))}
      </div>
    )
  } else if (configQuery.isError) {
    packageContent = (
      <Alert variant='destructive' className='bg-transparent'>
        <CircleAlert aria-hidden='true' />
        <AlertTitle>{t('Failed to load reseller pricing')}</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-3'>
          <span>
            {t('Pricing is unavailable until the connection is restored.')}
          </span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={configQuery.isFetching}
            onClick={() => void configQuery.refetch()}
          >
            {configQuery.isFetching ? (
              <Spinner data-icon='inline-start' aria-hidden='true' />
            ) : (
              <RefreshCw data-icon='inline-start' aria-hidden='true' />
            )}
            {t('Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else {
    packageContent = (
      <GothicResellerCards
        tokenMillions={tokenMillions}
        markupPercent={markupPercent}
        baseCostPerMillion={baseCostPerMillion}
        formatMoney={formatMoney}
        onSelect={(nextTokenMillions) => {
          form.setValue('tokenMillions', nextTokenMillions, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }}
      />
    )
  }

  let configuratorContent: ReactNode
  if (configQuery.isPending) {
    configuratorContent = (
      <section
        className='reseller-tool-card flex min-h-80 flex-col gap-4 p-4'
        aria-label={t('Loading key setup')}
      >
        <Skeleton className='h-6 w-40' />
        <Skeleton className='h-4 w-64 max-w-full' />
        <div className='mt-3 grid gap-4 sm:grid-cols-2'>
          {FORM_SKELETON_IDS.map((id) => (
            <Skeleton key={id} className='h-16 w-full' />
          ))}
        </div>
      </section>
    )
  } else if (configQuery.isError) {
    configuratorContent = (
      <section className='reseller-tool-card flex min-h-80 items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>
          {t('Key setup is unavailable.')}
        </p>
      </section>
    )
  } else {
    configuratorContent = (
      <ResellerConfigurator
        form={form}
        quote={quote}
        formatMoney={formatMoney}
        onSubmit={handleIssueKey}
        isSubmitting={createKeyMutation.isPending}
      />
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Reseller')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='reseller-page-surface w-full'>
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
                    'Usage deducted from the key quota: input tokens + output tokens - cached tokens.'
                  )}
                </p>
              </div>

              <div className='reseller-endpoint-panel'>
                <div className='flex items-center gap-2'>
                  <Globe2 className='text-primary size-4' aria-hidden='true' />
                  <p className='text-sm font-medium'>
                    {t('Reseller endpoint')}
                  </p>
                </div>
                {configQuery.data ? (
                  <div className='reseller-secret-row mt-3'>
                    <Server
                      className='text-muted-foreground size-4 shrink-0'
                      aria-hidden='true'
                    />
                    <code className='min-w-0 flex-1 truncate text-xs'>
                      {configuredEndpoint}
                    </code>
                    <CopyButton
                      value={configuredEndpoint}
                      tooltip={t('Copy endpoint')}
                      aria-label={t('Copy endpoint')}
                    />
                  </div>
                ) : null}
                <p className='text-muted-foreground mt-2 text-xs leading-5'>
                  {t('Clients use this address with issued reseller keys.')}
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
                {configQuery.data ? (
                  <p className='text-muted-foreground text-xs'>
                    {t('Base cost')}: {formatMoney(baseCostPerMillion)} / 1M
                  </p>
                ) : null}
              </div>

              {packageContent}
            </section>

            <div className='grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]'>
              {configuratorContent}
              <ResellerKeyVault
                keys={keysQuery.data ?? []}
                formatMoney={formatMoney}
                revealedKeys={revealedKeys}
                revealingKeyId={revealingKeyId}
                isLoading={keysQuery.isPending}
                isFetching={keysQuery.isFetching}
                isError={keysQuery.isError}
                errorMessage={
                  keysQuery.error instanceof Error
                    ? t(keysQuery.error.message)
                    : undefined
                }
                onRetry={() => void keysQuery.refetch()}
                onReveal={(id) => void handleRevealKey(id)}
              />
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
