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
import { useQueryClient } from '@tanstack/react-query'
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
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const createResellerPricingSchema = (t: (key: string) => string) =>
  z.object({
    reseller_setting: z.object({
      base_cost_per_million: z
        .number()
        .min(0.01, t('Base cost must be greater than 0'))
        .multipleOf(0.01, t('Use no more than two decimal places.'))
        .max(1_000_000, t('Base cost must not exceed 1,000,000 USD')),
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
  const queryClient = useQueryClient()
  const updateOption = useUpdateOption()
  const schema = createResellerPricingSchema(t)

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<ResellerPricingFormValues>({
      resolver: zodResolver(schema),
      defaultValues: props.defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          if (typeof value !== 'number' && typeof value !== 'string') continue

          await updateOption.mutateAsync({
            key,
            value: String(value),
          })
        }

        await queryClient.invalidateQueries({
          queryKey: ['reseller', 'config'],
        })
      },
    })

  const isSaving = updateOption.isPending || isSubmitting

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
