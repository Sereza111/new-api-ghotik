import { zodResolver } from '@hookform/resolvers/zod'
import { CircleDashed, Server } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useCallback, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { FortuneAtmosphere } from '@/features/home/components/fortune-atmosphere'

import { ResellerConfigurator } from './components/reseller-configurator'
import { ResellerKeyVault } from './components/reseller-key-vault'
import { ResellerPackageCard } from './components/reseller-package-card'
import {
  calculateResellerQuote,
  RESELLER_ENDPOINT,
  RESELLER_PACKAGE_OPTIONS,
  resellerDraftSchema,
} from './lib/pricing'
import type { DemoResellerKey, ResellerDraftValues } from './types'

const DEFAULT_DRAFT: ResellerDraftValues = {
  clientLabel: '',
  tokenMillions: 10,
  markupPercent: 80,
  term: 'unlimited',
}

export function Reseller() {
  const { i18n, t } = useTranslation()
  const [preparedKeys, setPreparedKeys] = useState<DemoResellerKey[]>([])
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
                  <Server className='text-primary size-4' aria-hidden='true' />
                  <span className='text-sm font-medium'>
                    {t('Reseller endpoint')}
                  </span>
                  <Badge variant='secondary' className='ms-auto'>
                    {t('Temporary address')}
                  </Badge>
                </div>
                <div className='bg-background/70 mt-3 flex min-w-0 items-center gap-2 rounded-md border py-1.5 ps-3 pe-1.5'>
                  <code className='min-w-0 flex-1 truncate text-xs'>
                    {RESELLER_ENDPOINT}
                  </code>
                  <CopyButton
                    value={RESELLER_ENDPOINT}
                    tooltip={t('Copy endpoint')}
                    aria-label={t('Copy endpoint')}
                  />
                </div>
                <p className='text-muted-foreground mt-2 text-xs leading-5'>
                  {t(
                    'The final resale domain will replace this address later.'
                  )}
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

              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                {RESELLER_PACKAGE_OPTIONS.map((item) => {
                  const packageQuote = calculateResellerQuote(
                    item.tokenMillions,
                    markupPercent
                  )
                  return (
                    <ResellerPackageCard
                      key={item.id}
                      tokenMillions={item.tokenMillions}
                      numeral={item.numeral}
                      featured={item.featured}
                      cost={formatMoney(packageQuote.cost)}
                      selected={tokenMillions === item.tokenMillions}
                      onSelect={() => {
                        form.setValue('tokenMillions', item.tokenMillions, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }}
                    />
                  )
                })}
              </div>
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
