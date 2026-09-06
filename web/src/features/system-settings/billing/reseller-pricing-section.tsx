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
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateResellerCommercialSettings } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const createResellerPricingSchema = (t: (key: string) => string) =>
  z.object({
    reseller_setting: z.object({
      base_cost_per_million: z
        .number()
        .min(0.01, t('Base cost must be greater than 0'))
        .multipleOf(0.01, t('Use no more than two decimal places.'))
        .max(1_000_000, t('Base cost must not exceed 1,000,000 USD')),
      subscription_price: z
        .number()
        .min(0.01, t('Subscription price must be at least 0.01 USD'))
        .multipleOf(0.01, t('Use no more than two decimal places.'))
        .max(1_000_000, t('Subscription price must not exceed 1,000,000 USD')),
      subscription_discount_percent: z
        .number()
        .int(t('Discount must be a whole number'))
        .min(0, t('Discount cannot be negative'))
        .max(90, t('Discount must not exceed 90%')),
      subscription_duration_days: z
        .number()
        .int(t('Duration must be a whole number of days'))
        .min(1, t('Duration must be at least 1 day'))
        .max(3650, t('Duration must not exceed 3650 days')),
      endpoint: z
        .string()
        .trim()
        .min(1, t('Reseller endpoint is required'))
        .superRefine((value, context) => {
          if (!value) return

          const hasInvalidCharacter = [...value].some(
            (character) => character.charCodeAt(0) <= 0x20
          )

          try {
            const endpoint = new URL(value)
            const isValid =
              !hasInvalidCharacter &&
              (endpoint.protocol === 'http:' ||
                endpoint.protocol === 'https:') &&
              endpoint.hostname.length > 0 &&
              endpoint.username === '' &&
              endpoint.password === '' &&
              endpoint.search === '' &&
              endpoint.hash === ''

            if (isValid) return
          } catch {
            // The validation issue below covers malformed URLs.
          }

          context.addIssue({
            code: 'custom',
            message: t(
              'Enter a valid HTTP or HTTPS URL without credentials, query parameters, or fragments'
            ),
          })
        }),
    }),
  })

type ResellerPricingFormValues = z.infer<
  ReturnType<typeof createResellerPricingSchema>
>

type ResellerPricingSectionProps = {
  defaultValues: ResellerPricingFormValues
}

export function ResellerPricingSection(props: ResellerPricingSectionProps) {
  const { t } = useTranslation()
  const updateResellerSettings = useUpdateResellerCommercialSettings()
  const schema = createResellerPricingSchema(t)

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<ResellerPricingFormValues>({
      resolver: zodResolver(schema),
      defaultValues: props.defaultValues,
      onSubmit: async (data) => {
        await updateResellerSettings.mutateAsync({
          base_cost_per_million: data.reseller_setting.base_cost_per_million,
          endpoint: data.reseller_setting.endpoint,
          subscription_price: data.reseller_setting.subscription_price,
          subscription_discount_percent:
            data.reseller_setting.subscription_discount_percent,
          subscription_duration_days:
            data.reseller_setting.subscription_duration_days,
        })
      },
    })

  const isSaving = updateResellerSettings.isPending || isSubmitting

  return (
    <>
      <FormNavigationGuard when={isDirty} />

      <SettingsSection title={t('Reseller pricing')}>
        <Form {...form}>
          <SettingsForm onSubmit={handleSubmit} autoComplete='off'>
            <SettingsPageFormActions
              onSave={handleSubmit}
              onReset={handleReset}
              isSaving={isSaving}
              isSaveDisabled={!isDirty}
              isResetDisabled={!isDirty}
            />
            <FormDirtyIndicator isDirty={isDirty} />

            <FormField
              control={form.control}
              name='reseller_setting.base_cost_per_million'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Base cost per 1M tokens (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0.01}
                      max={1_000_000}
                      step='0.01'
                      disabled={isSaving}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Used to calculate all reseller package prices.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              data-settings-form-span='full'
              className='border-border/70 border-t pt-2'
            >
              <h3 className='text-sm font-semibold'>
                {t('Reseller subscription')}
              </h3>
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Controls paid access to reseller key issuance.')}
              </p>
            </div>

            <FormField
              control={form.control}
              name='reseller_setting.subscription_price'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Subscription price (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0.01}
                      max={1_000_000}
                      step='0.01'
                      disabled={isSaving}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Price before the optional reseller discount.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='reseller_setting.subscription_discount_percent'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Subscription discount (%)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={90}
                      step={1}
                      disabled={isSaving}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Applied to the displayed and charged subscription price.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='reseller_setting.subscription_duration_days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Subscription duration (days)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={3650}
                      step={1}
                      disabled={isSaving}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Sets how many days of access each purchase provides.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='reseller_setting.endpoint'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Reseller endpoint')}</FormLabel>
                  <FormControl>
                    <Input
                      type='url'
                      placeholder='https://pugshop.ru/v1'
                      autoCapitalize='none'
                      autoCorrect='off'
                      spellCheck={false}
                      disabled={isSaving}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Clients use this address with issued reseller keys.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsForm>
        </Form>
      </SettingsSection>
    </>
  )
}
