import { KeyRound, ShieldCheck } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import {
  RESELLER_MARKUP_OPTIONS,
  RESELLER_MAX_MILLIONS,
  RESELLER_MIN_MILLIONS,
} from '../lib/pricing'
import type { ResellerDraftValues, ResellerQuote } from '../types'

type ResellerConfiguratorProps = {
  form: UseFormReturn<ResellerDraftValues>
  quote: ResellerQuote
  formatMoney: (value: number) => string
  onSubmit: (values: ResellerDraftValues) => void
  isSubmitting: boolean
}

const TERM_KEYS: Record<ResellerDraftValues['term'], string> = {
  unlimited: 'No expiration',
  '7-days': '7 days',
  '30-days': '30 days',
  '90-days': '90 days',
}

export function ResellerConfigurator(props: ResellerConfiguratorProps) {
  const { t } = useTranslation()
  const errors = props.form.formState.errors
  const markupPercent = props.form.watch('markupPercent')

  return (
    <Card data-card-hover='false' className='reseller-tool-card h-full'>
      <form
        className='flex h-full flex-col'
        aria-busy={props.isSubmitting}
        onSubmit={props.form.handleSubmit(props.onSubmit)}
      >
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <KeyRound className='text-primary size-5' aria-hidden='true' />
            {t('Key setup')}
          </CardTitle>
          <CardDescription>
            {t('Configure the quota and suggested resale price.')}
          </CardDescription>
        </CardHeader>

        <fieldset className='contents' disabled={props.isSubmitting}>
          <CardContent className='mt-4 flex flex-1 flex-col gap-5'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex flex-col gap-2'>
                <label
                  htmlFor='reseller-client-label'
                  className='text-sm font-medium'
                >
                  {t('Client label')}
                </label>
                <Input
                  id='reseller-client-label'
                  placeholder={t('e.g. Acme Studio')}
                  aria-invalid={Boolean(errors.clientLabel)}
                  {...props.form.register('clientLabel')}
                />
                {errors.clientLabel ? (
                  <p className='text-destructive text-xs'>
                    {t('Use up to 50 characters.')}
                  </p>
                ) : null}
              </div>

              <div className='flex flex-col gap-2'>
                <label
                  htmlFor='reseller-token-amount'
                  className='text-sm font-medium'
                >
                  {t('Custom amount')}
                </label>
                <div className='relative'>
                  <Input
                    id='reseller-token-amount'
                    type='number'
                    min={RESELLER_MIN_MILLIONS}
                    max={RESELLER_MAX_MILLIONS}
                    step={1}
                    className='pr-20 tabular-nums'
                    aria-invalid={Boolean(errors.tokenMillions)}
                    {...props.form.register('tokenMillions', {
                      valueAsNumber: true,
                    })}
                  />
                  <span className='text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs'>
                    {t('Million tokens')}
                  </span>
                </div>
                {errors.tokenMillions ? (
                  <p className='text-destructive text-xs'>
                    {t('Enter between 1 and 1000 million tokens.')}
                  </p>
                ) : null}
              </div>
            </div>

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex flex-col gap-2'>
                <span className='text-sm font-medium'>
                  {t('Display margin')}
                </span>
                <ToggleGroup
                  value={[String(markupPercent)]}
                  onValueChange={(values) => {
                    const next = Number(values[0])
                    if (!Number.isFinite(next)) return
                    props.form.setValue('markupPercent', next, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }}
                  variant='outline'
                  spacing={1}
                  aria-label={t('Display margin')}
                  className='grid w-full grid-cols-4'
                >
                  {RESELLER_MARKUP_OPTIONS.map((option) => (
                    <ToggleGroupItem key={option} value={String(option)}>
                      +{option}%
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className='text-muted-foreground text-xs leading-5'>
                  {t('Margin sets the suggested price shown to your client.')}
                </p>
              </div>

              <div className='flex flex-col gap-2'>
                <label htmlFor='reseller-term' className='text-sm font-medium'>
                  {t('Validity period')}
                </label>
                <NativeSelect
                  id='reseller-term'
                  className='w-full'
                  {...props.form.register('term')}
                >
                  {Object.entries(TERM_KEYS).map(([value, key]) => (
                    <NativeSelectOption key={value} value={value}>
                      {t(key)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <dl className='reseller-quote-grid grid overflow-hidden sm:grid-cols-3'>
              <div>
                <dt>{t('Cost')}</dt>
                <dd>{props.formatMoney(props.quote.cost)}</dd>
              </div>
              <div>
                <dt>{t('Client price')}</dt>
                <dd>{props.formatMoney(props.quote.clientPrice)}</dd>
              </div>
              <div>
                <dt>{t('Profit')}</dt>
                <dd>{props.formatMoney(props.quote.profit)}</dd>
              </div>
            </dl>
          </CardContent>
        </fieldset>

        <CardFooter className='border-border/40 mt-5 flex flex-col items-stretch justify-between gap-3 bg-transparent sm:flex-row sm:items-center'>
          <p className='text-muted-foreground flex items-center gap-2 text-xs leading-5'>
            <ShieldCheck className='size-4 shrink-0' aria-hidden='true' />
            {t('The key cost is charged from your balance when it is issued.')}
          </p>
          <Button
            type='submit'
            size='lg'
            className='sm:shrink-0'
            disabled={props.isSubmitting}
          >
            {props.isSubmitting ? (
              <Spinner data-icon='inline-start' aria-hidden='true' />
            ) : (
              <KeyRound data-icon='inline-start' />
            )}
            {props.isSubmitting ? t('Issuing key...') : t('Issue reseller key')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
