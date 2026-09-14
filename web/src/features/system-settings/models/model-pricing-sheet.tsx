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
import { AlertTriangle, Save } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import {
  calculateDiscountPercent,
  calculateReferencePriceFromDiscount,
} from '@/features/pricing/lib/reference-price'
import {
  createDefaultTaskVisualConfig,
  generateTaskExprFromConfig,
} from '@/features/pricing/lib/task-expr'
import { cn } from '@/lib/utils'

import {
  SettingsControlGroup,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import {
  EMPTY_LANE_ENABLED,
  EMPTY_LANE_PRICES,
  buildPreviewRows,
  createInitialLaneState,
  createModelPricingSchema,
  hasValue,
  laneConfigs,
  numericDraftRegex,
  ratioFieldByLane,
  toNumberOrNull,
  type LaneKey,
  type ModelPricingFormValues,
  type ModelRatioData,
  type PricingMode,
} from './model-pricing-core'
import { PriceInput, PriceLane } from './model-pricing-inputs'
import { formatPricingNumber } from './pricing-format'
import { TaskUsagePricingEditor } from './task-usage-pricing-editor'
import { TieredPricingEditor } from './tiered-pricing-editor'

export type { ModelRatioData } from './model-pricing-core'

type ModelPricingSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editData?: ModelRatioData | null
  onSave?: () => void | Promise<void>
  isSaving?: boolean
}

type ModelPricingEditorPanelProps = Omit<
  ModelPricingSheetProps,
  'open' | 'onOpenChange'
> & {
  className?: string
}

export type ModelPricingEditorPanelHandle = {
  commitDraft: () => Promise<ModelRatioData | null>
}

const DEFAULT_TOKEN_BILLING_EXPR = 'tier("base", p * 0 + c * 0)'

type ReferencePriceDraft = {
  input: string
  output: string
  request: string
}

const EMPTY_REFERENCE_PRICE_DRAFT: ReferencePriceDraft = {
  input: '',
  output: '',
  request: '',
}

export const ModelPricingSheet = forwardRef<
  ModelPricingEditorPanelHandle,
  ModelPricingSheetProps
>(function ModelPricingSheet(
  { open, onOpenChange, editData, onSave, isSaving },
  ref
) {
  const { t } = useTranslation()
  const title = editData ? t('Edit model pricing') : t('Add model pricing')
  const description = editData?.name || t('New model')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-2xl')}
      >
        <SheetHeader className='sr-only'>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <ModelPricingEditorPanel
          ref={ref}
          editData={editData}
          onSave={onSave}
          isSaving={isSaving}
          className='h-full rounded-none border-0'
        />
      </SheetContent>
    </Sheet>
  )
})

export const ModelPricingEditorPanel = forwardRef<
  ModelPricingEditorPanelHandle,
  ModelPricingEditorPanelProps
>(function ModelPricingEditorPanel(
  { editData, className, onSave, isSaving },
  ref
) {
  const { t } = useTranslation()
  const [pricingMode, setPricingMode] = useState<PricingMode>('per-token')
  const [promptPrice, setPromptPrice] = useState('')
  const [lanePrices, setLanePrices] = useState<Record<LaneKey, string>>({
    ...EMPTY_LANE_PRICES,
  })
  const [laneEnabled, setLaneEnabled] = useState<Record<LaneKey, boolean>>({
    ...EMPTY_LANE_ENABLED,
  })
  const [billingExpr, setBillingExpr] = useState('')
  const [requestRuleExpr, setRequestRuleExpr] = useState('')
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [discountPercent, setDiscountPercent] = useState('')
  const [referencePriceDraft, setReferencePriceDraft] =
    useState<ReferencePriceDraft>({ ...EMPTY_REFERENCE_PRICE_DRAFT })
  const [discountError, setDiscountError] = useState<string | null>(null)
  const [editorReloadToken, setEditorReloadToken] = useState(0)
  const autoSwitchedForRef = useRef<string | null>(null)
  const isEditMode = !!editData
  const { models: pricingModels } = usePricingData()

  const form = useForm<ModelPricingFormValues>({
    resolver: zodResolver(createModelPricingSchema(t)),
    defaultValues: {
      name: '',
      price: '',
      ratio: '',
      cacheRatio: '',
      createCacheRatio: '',
      completionRatio: '',
      imageRatio: '',
      audioRatio: '',
      audioCompletionRatio: '',
    },
  })
  const watchedValues = form.watch()
  const usageSchemaByModel = useMemo(
    () =>
      new Map(
        pricingModels.map((model) => [
          model.model_name,
          model.billing_usage_schema,
        ])
      ),
    [pricingModels]
  )
  const usageExamplesByModel = useMemo(
    () =>
      new Map(
        pricingModels.map((model) => [
          model.model_name,
          model.billing_usage_examples,
        ])
      ),
    [pricingModels]
  )
  const taskUsageSchema = usageSchemaByModel.get(watchedValues.name.trim())
  const taskUsageExamples = usageExamplesByModel.get(watchedValues.name.trim())
  const defaultTaskBillingExpr = useMemo(
    () =>
      taskUsageSchema
        ? generateTaskExprFromConfig(
            createDefaultTaskVisualConfig(taskUsageSchema),
            taskUsageSchema
          )
        : '',
    [taskUsageSchema]
  )
  const resolvedBillingExpr =
    taskUsageSchema &&
    (!billingExpr || billingExpr === DEFAULT_TOKEN_BILLING_EXPR)
      ? defaultTaskBillingExpr
      : billingExpr
  const selectedPricingModel = useMemo(
    () =>
      pricingModels.find(
        (model) => model.model_name === watchedValues.name.trim()
      ),
    [pricingModels, watchedValues.name]
  )
  const currentInputPrice = toNumberOrNull(promptPrice)
  const configuredOutputPrice =
    laneEnabled.completion && hasValue(lanePrices.completion)
      ? toNumberOrNull(lanePrices.completion)
      : null
  const currentOutputPrice =
    configuredOutputPrice ??
    (currentInputPrice === null
      ? null
      : currentInputPrice * (selectedPricingModel?.completion_ratio ?? 1))
  const currentRequestPrice = toNumberOrNull(watchedValues.price)

  useEffect(() => {
    const nextLaneState = createInitialLaneState(editData)
    let nextPricingMode: PricingMode = 'per-token'

    if (editData) {
      form.reset({
        name: editData.name,
        price: editData.price || '',
        ratio: editData.ratio || '',
        cacheRatio: editData.cacheRatio || '',
        createCacheRatio: editData.createCacheRatio || '',
        completionRatio: editData.completionRatio || '',
        imageRatio: editData.imageRatio || '',
        audioRatio: editData.audioRatio || '',
        audioCompletionRatio: editData.audioCompletionRatio || '',
      })
      if (editData.billingMode === 'tiered_expr') {
        nextPricingMode = 'tiered_expr'
      } else if (editData.price) {
        nextPricingMode = 'per-request'
      }
      setPricingMode(nextPricingMode)
      setBillingExpr(editData.billingExpr || '')
      setRequestRuleExpr(editData.requestRuleExpr || '')
    } else {
      form.reset({
        name: '',
        price: '',
        ratio: '',
        cacheRatio: '',
        createCacheRatio: '',
        completionRatio: '',
        imageRatio: '',
        audioRatio: '',
        audioCompletionRatio: '',
      })
      setPricingMode('per-token')
      setBillingExpr('')
      setRequestRuleExpr('')
    }

    const currentDiscountPrice =
      nextPricingMode === 'per-request'
        ? toNumberOrNull(editData?.price)
        : toNumberOrNull(nextLaneState.promptPrice)
    const configuredReferencePrice =
      nextPricingMode === 'per-request'
        ? editData?.referencePrice?.request_usd
        : editData?.referencePrice?.input_usd
    const configuredDiscount =
      currentDiscountPrice === null
        ? null
        : calculateDiscountPercent(
            configuredReferencePrice ?? null,
            currentDiscountPrice
          )

    setDiscountEnabled(
      nextPricingMode !== 'tiered_expr' && configuredReferencePrice != null
    )
    setDiscountPercent(configuredDiscount?.toString() ?? '')
    setReferencePriceDraft({
      input: formatPricingNumber(editData?.referencePrice?.input_usd),
      output: formatPricingNumber(editData?.referencePrice?.output_usd),
      request: formatPricingNumber(editData?.referencePrice?.request_usd),
    })
    setDiscountError(null)

    setPromptPrice(nextLaneState.promptPrice)
    setLanePrices(nextLaneState.prices)
    setLaneEnabled(nextLaneState.enabled)
    setEditorReloadToken((token) => token + 1)
    autoSwitchedForRef.current = null
  }, [editData, form])

  useEffect(() => {
    if (!editData) return
    if (editData.billingMode === 'tiered_expr') return
    if (editData.price || editData.ratio) return

    const usageSchema = usageSchemaByModel.get(editData.name)
    if (!usageSchema || Object.keys(usageSchema).length === 0) return
    if (autoSwitchedForRef.current === editData.name) return

    setPricingMode('tiered_expr')
    autoSwitchedForRef.current = editData.name
  }, [editData, usageSchemaByModel])

  const setFormValue = (field: keyof ModelPricingFormValues, value: string) => {
    form.setValue(field, value, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const deriveLaneRatio = (
    lane: LaneKey,
    price: string,
    nextPromptPrice = promptPrice,
    nextLanePrices = lanePrices
  ) => {
    const priceNumber = toNumberOrNull(price)
    if (priceNumber === null) return ''

    if (lane === 'audioOutput') {
      const audioInputPrice = toNumberOrNull(nextLanePrices.audioInput)
      if (audioInputPrice === null || audioInputPrice === 0) return ''
      return formatPricingNumber(priceNumber / audioInputPrice)
    }

    const inputPrice = toNumberOrNull(nextPromptPrice)
    if (inputPrice === null || inputPrice === 0) return ''
    return formatPricingNumber(priceNumber / inputPrice)
  }

  const syncLaneRatios = (
    nextPromptPrice = promptPrice,
    nextLanePrices = lanePrices,
    nextLaneEnabled = laneEnabled
  ) => {
    const inputPrice = toNumberOrNull(nextPromptPrice)
    setFormValue(
      'ratio',
      inputPrice !== null ? formatPricingNumber(inputPrice / 2) : ''
    )

    laneConfigs.forEach(({ key }) => {
      const ratioField = ratioFieldByLane[key]
      if (!nextLaneEnabled[key]) {
        setFormValue(ratioField, '')
        return
      }
      setFormValue(
        ratioField,
        deriveLaneRatio(
          key,
          nextLanePrices[key],
          nextPromptPrice,
          nextLanePrices
        )
      )
    })
  }

  const handlePromptPriceChange = (value: string) => {
    if (!numericDraftRegex.test(value)) return
    setPromptPrice(value)
    syncLaneRatios(value, lanePrices, laneEnabled)
    const nextDiscount = calculateDiscountPercent(
      toNumberOrNull(referencePriceDraft.input),
      toNumberOrNull(value) ?? Number.NaN
    )
    if (discountEnabled && nextDiscount !== null) {
      setDiscountPercent(nextDiscount.toString())
      setDiscountError(null)
    }
  }

  const handleLanePriceChange = (lane: LaneKey, value: string) => {
    if (!numericDraftRegex.test(value)) return
    const nextLanePrices = { ...lanePrices, [lane]: value }
    setLanePrices(nextLanePrices)

    if (laneEnabled[lane]) {
      setFormValue(
        ratioFieldByLane[lane],
        deriveLaneRatio(lane, value, promptPrice, nextLanePrices)
      )
    }

    if (lane === 'audioInput' && laneEnabled.audioOutput) {
      setFormValue(
        'audioCompletionRatio',
        deriveLaneRatio(
          'audioOutput',
          nextLanePrices.audioOutput,
          promptPrice,
          nextLanePrices
        )
      )
    }

    if (lane === 'completion' && discountEnabled) {
      const nextDiscount = calculateDiscountPercent(
        toNumberOrNull(referencePriceDraft.output),
        toNumberOrNull(value) ?? Number.NaN
      )
      if (nextDiscount !== null) {
        setDiscountPercent(nextDiscount.toString())
        setDiscountError(null)
      }
    }
  }

  const handleLaneToggle = (lane: LaneKey, checked: boolean) => {
    const nextEnabled = { ...laneEnabled, [lane]: checked }
    let nextPrices = lanePrices

    if (!checked) {
      nextPrices = { ...nextPrices, [lane]: '' }
      setFormValue(ratioFieldByLane[lane], '')
      if (lane === 'audioInput') {
        nextEnabled.audioOutput = false
        nextPrices.audioOutput = ''
        setFormValue('audioCompletionRatio', '')
      }
    }

    setLaneEnabled(nextEnabled)
    setLanePrices(nextPrices)

    if (checked) {
      setFormValue(
        ratioFieldByLane[lane],
        deriveLaneRatio(lane, nextPrices[lane], promptPrice, nextPrices)
      )
    }
  }

  const handleModeChange = (value: string) => {
    const nextMode = value as PricingMode
    setPricingMode(nextMode)
    if (nextMode === 'tiered_expr' && !billingExpr) {
      setBillingExpr(defaultTaskBillingExpr || DEFAULT_TOKEN_BILLING_EXPR)
    }
  }

  const applyDiscountToReferencePrices = (discount: number) => {
    if (pricingMode === 'per-request') {
      const requestPrice =
        currentRequestPrice === null
          ? null
          : calculateReferencePriceFromDiscount(currentRequestPrice, discount)
      setReferencePriceDraft((current) => ({
        ...current,
        request: formatPricingNumber(requestPrice),
      }))
      return
    }

    const inputPrice =
      currentInputPrice === null
        ? null
        : calculateReferencePriceFromDiscount(currentInputPrice, discount)
    const outputPrice =
      currentOutputPrice === null
        ? null
        : calculateReferencePriceFromDiscount(currentOutputPrice, discount)
    setReferencePriceDraft((current) => ({
      ...current,
      input: formatPricingNumber(inputPrice),
      output: formatPricingNumber(outputPrice),
    }))
  }

  const handleDiscountToggle = (checked: boolean) => {
    setDiscountEnabled(checked)
    setDiscountError(null)
    if (!checked) return

    const nextDiscount = discountPercent || '10'
    setDiscountPercent(nextDiscount)
    const discount = toNumberOrNull(nextDiscount)
    if (discount !== null && discount > 0 && discount < 100) {
      applyDiscountToReferencePrices(discount)
    }
  }

  const handleDiscountChange = (value: string) => {
    if (!numericDraftRegex.test(value)) return
    setDiscountPercent(value)
    const discount = toNumberOrNull(value)
    if (discount === null) {
      setDiscountError(null)
      return
    }
    if (discount <= 0 || discount >= 100) {
      setDiscountError(t('Enter a discount greater than 0 and less than 100.'))
      return
    }
    setDiscountError(null)
    applyDiscountToReferencePrices(discount)
  }

  const handleReferencePriceChange = (
    field: keyof ReferencePriceDraft,
    value: string
  ) => {
    if (!numericDraftRegex.test(value)) return
    setReferencePriceDraft((current) => ({ ...current, [field]: value }))

    let currentPrice = currentRequestPrice
    if (field === 'input') currentPrice = currentInputPrice
    if (field === 'output') currentPrice = currentOutputPrice

    const discount = calculateDiscountPercent(
      toNumberOrNull(value),
      currentPrice ?? Number.NaN
    )
    if (discount === null) {
      setDiscountError(
        value
          ? t('Regular prices must be greater than the final prices.')
          : null
      )
      return
    }
    setDiscountPercent(discount.toString())
    setDiscountError(null)
  }

  const referencePrice = useMemo(() => {
    if (!discountEnabled || pricingMode === 'tiered_expr') return undefined

    if (pricingMode === 'per-request') {
      const requestPrice = toNumberOrNull(referencePriceDraft.request)
      return requestPrice === null || requestPrice <= 0
        ? undefined
        : { request_usd: Number(formatPricingNumber(requestPrice)) }
    }

    const referenceInputPrice = toNumberOrNull(referencePriceDraft.input)
    const referenceOutputPrice = toNumberOrNull(referencePriceDraft.output)
    if (
      referenceInputPrice === null ||
      referenceInputPrice <= 0 ||
      referenceOutputPrice === null ||
      referenceOutputPrice <= 0
    ) {
      return undefined
    }
    return {
      input_usd: Number(formatPricingNumber(referenceInputPrice)),
      output_usd: Number(formatPricingNumber(referenceOutputPrice)),
    }
  }, [
    discountEnabled,
    pricingMode,
    referencePriceDraft.input,
    referencePriceDraft.output,
    referencePriceDraft.request,
  ])

  const previewDiscountPercent =
    pricingMode === 'per-request'
      ? calculateDiscountPercent(
          referencePrice?.request_usd ?? null,
          currentRequestPrice ?? Number.NaN
        )
      : calculateDiscountPercent(
          referencePrice?.input_usd ?? null,
          currentInputPrice ?? Number.NaN
        )

  const previewRows = useMemo(() => {
    const rows = buildPreviewRows(
      watchedValues,
      pricingMode,
      resolvedBillingExpr,
      requestRuleExpr,
      promptPrice,
      lanePrices,
      laneEnabled,
      t
    )
    if (!referencePrice || previewDiscountPercent === null) return rows

    const prices =
      pricingMode === 'per-request'
        ? [`$${formatPricingNumber(referencePrice.request_usd)}`]
        : [
            `$${formatPricingNumber(referencePrice.input_usd)}`,
            `$${formatPricingNumber(referencePrice.output_usd)}`,
          ]
    return [
      ...rows,
      {
        key: 'discount',
        label: t('Discount'),
        value: `-${previewDiscountPercent}%`,
      },
      {
        key: 'referencePrice',
        label: t('Regular price'),
        value: prices.join(' / '),
      },
    ]
  }, [
    resolvedBillingExpr,
    laneEnabled,
    lanePrices,
    pricingMode,
    promptPrice,
    requestRuleExpr,
    referencePrice,
    previewDiscountPercent,
    t,
    watchedValues,
  ])

  const warnings = useMemo(() => {
    const nextWarnings: string[] = []
    const hasConflict =
      !!editData?.price &&
      [
        editData.ratio,
        editData.completionRatio,
        editData.cacheRatio,
        editData.createCacheRatio,
        editData.imageRatio,
        editData.audioRatio,
        editData.audioCompletionRatio,
      ].some(hasValue)

    if (hasConflict) {
      nextWarnings.push(
        t(
          'This model has both fixed-price and token-price settings. Saving the current mode will rewrite the conflicting fields.'
        )
      )
    }

    if (
      pricingMode === 'per-token' &&
      toNumberOrNull(promptPrice) === null &&
      laneConfigs.some(
        ({ key }) => laneEnabled[key] && hasValue(lanePrices[key])
      )
    ) {
      nextWarnings.push(
        t('Input price is required before saving dependent prices.')
      )
    }

    if (
      pricingMode === 'per-token' &&
      laneEnabled.audioOutput &&
      !hasValue(lanePrices.audioInput)
    ) {
      nextWarnings.push(t('Audio output price requires an audio input price.'))
    }

    return nextWarnings
  }, [editData, laneEnabled, lanePrices, pricingMode, promptPrice, t])

  const validatePricingValues = useCallback(() => {
    if (discountEnabled && pricingMode !== 'tiered_expr') {
      const discount = toNumberOrNull(discountPercent)
      if (
        discountPercent &&
        (discount === null || discount <= 0 || discount >= 100)
      ) {
        setDiscountError(
          t('Enter a discount greater than 0 and less than 100.')
        )
        return false
      }
      if (!referencePrice) {
        setDiscountError(t('Enter valid regular prices.'))
        return false
      }
      if (pricingMode === 'per-request') {
        if (currentRequestPrice === null) {
          setDiscountError(t('Set a valid price before enabling the discount.'))
          return false
        }
        if ((referencePrice.request_usd ?? 0) <= currentRequestPrice) {
          setDiscountError(
            t('Regular prices must be greater than the final prices.')
          )
          return false
        }
      } else if (currentInputPrice === null || currentOutputPrice === null) {
        setDiscountError(t('Set a valid price before enabling the discount.'))
        return false
      } else if (
        (referencePrice.input_usd ?? 0) <= currentInputPrice ||
        (referencePrice.output_usd ?? 0) <= currentOutputPrice
      ) {
        setDiscountError(
          t('Regular prices must be greater than the final prices.')
        )
        return false
      }
    }

    if (
      pricingMode === 'per-token' &&
      toNumberOrNull(promptPrice) === null &&
      laneConfigs.some(
        ({ key }) => laneEnabled[key] && hasValue(lanePrices[key])
      )
    ) {
      form.setError('ratio', {
        message: t('Input price is required before saving dependent prices.'),
      })
      return false
    }

    if (
      pricingMode === 'per-token' &&
      laneEnabled.audioOutput &&
      !hasValue(lanePrices.audioInput)
    ) {
      form.setError('audioRatio', {
        message: t('Audio output price requires an audio input price.'),
      })
      return false
    }

    return true
  }, [
    discountEnabled,
    discountPercent,
    currentInputPrice,
    currentOutputPrice,
    currentRequestPrice,
    form,
    laneEnabled,
    lanePrices,
    pricingMode,
    promptPrice,
    referencePrice,
    t,
  ])

  const buildSubmitData = useCallback(
    (values: ModelPricingFormValues) => {
      const data: ModelRatioData = {
        name: values.name.trim(),
        billingMode: pricingMode,
        price: values.price || '',
        ratio: values.ratio || '',
        cacheRatio: values.cacheRatio || '',
        createCacheRatio: values.createCacheRatio || '',
        completionRatio: values.completionRatio || '',
        imageRatio: values.imageRatio || '',
        audioRatio: values.audioRatio || '',
        audioCompletionRatio: values.audioCompletionRatio || '',
        referencePrice,
      }

      if (pricingMode === 'tiered_expr') {
        data.billingExpr = resolvedBillingExpr
        data.requestRuleExpr = requestRuleExpr
      }

      return data
    },
    [pricingMode, referencePrice, requestRuleExpr, resolvedBillingExpr]
  )

  useImperativeHandle(
    ref,
    () => ({
      commitDraft: async () => {
        const isValid = await form.trigger()
        if (!isValid || !validatePricingValues()) return null
        return buildSubmitData(form.getValues())
      },
    }),
    [form, validatePricingValues, buildSubmitData]
  )

  const showActions = Boolean(onSave)

  return (
    <div
      className={cn(
        'bg-background flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border',
        className
      )}
    >
      <div className='border-b p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <h3 className='truncate text-base font-medium'>
              {isEditMode ? t('Edit model pricing') : t('Add model pricing')}
            </h3>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={(event) => event.preventDefault()}
          className='flex min-h-0 flex-1 flex-col'
          autoComplete='off'
        >
          <div className='min-h-0 flex-1 overflow-y-auto p-4 pb-6'>
            <div className='grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]'>
              <FieldGroup>
                {warnings.length > 0 && (
                  <Alert variant='destructive'>
                    <AlertTriangle data-icon='inline-start' />
                    <AlertDescription>
                      <div className='flex flex-col gap-1'>
                        {warnings.map((warning) => (
                          <span key={warning}>{warning}</span>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Model name')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('gpt-4')}
                          {...field}
                          disabled={isEditMode}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'The exact model identifier as used in API requests.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Tabs
                  value={pricingMode}
                  onValueChange={handleModeChange}
                  className='gap-4'
                >
                  <TabsList className='grid w-full grid-cols-3'>
                    <TabsTrigger value='per-token'>
                      {t('Per-token')}
                    </TabsTrigger>
                    <TabsTrigger value='per-request'>
                      {t('Per-request')}
                    </TabsTrigger>
                    <TabsTrigger value='tiered_expr'>
                      {t('Expression')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value='per-token' className='pt-0'>
                    {taskUsageSchema &&
                      Object.keys(taskUsageSchema).length > 0 && (
                        <Alert className='mb-4'>
                          <AlertDescription className='flex flex-col gap-3 text-xs'>
                            <p>
                              {t(
                                'This is a task model billed by usage (e.g. seconds, resolution). Prices entered here act as a per-call base rate, not per-token prices.'
                              )}
                            </p>
                            <p>
                              {t(
                                'Tip: after configuring one model, select others in the table and use bulk copy.'
                              )}
                            </p>
                            <Button
                              type='button'
                              variant='outline'
                              size='sm'
                              className='w-fit'
                              onClick={() => handleModeChange('tiered_expr')}
                            >
                              {t('Configure task pricing')}
                            </Button>
                          </AlertDescription>
                        </Alert>
                      )}
                    <FieldGroup className='gap-5'>
                      <Field>
                        <FieldLabel>{t('Input price')}</FieldLabel>
                        <PriceInput
                          value={promptPrice}
                          placeholder='3'
                          onChange={handlePromptPriceChange}
                        />
                        <FieldDescription>
                          {t('USD price per 1M input tokens.')}
                        </FieldDescription>
                      </Field>

                      <div className='grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(400px,1fr))]'>
                        {laneConfigs.map((lane) => {
                          const disabled =
                            lane.key === 'audioOutput' &&
                            (!laneEnabled.audioInput ||
                              !hasValue(lanePrices.audioInput))
                          return (
                            <PriceLane
                              key={lane.key}
                              title={t(lane.titleKey)}
                              description={t(lane.descriptionKey)}
                              placeholder={lane.placeholder}
                              value={lanePrices[lane.key]}
                              enabled={laneEnabled[lane.key]}
                              disabled={disabled}
                              onEnabledChange={(checked) =>
                                handleLaneToggle(lane.key, checked)
                              }
                              onChange={(value) =>
                                handleLanePriceChange(lane.key, value)
                              }
                            />
                          )
                        })}
                      </div>
                    </FieldGroup>
                  </TabsContent>

                  <TabsContent value='per-request' className='pt-0'>
                    <FieldGroup className='gap-5'>
                      <FormField
                        control={form.control}
                        name='price'
                        render={({ field }) => (
                          <FormItem className='contents'>
                            <Field>
                              <FieldLabel>{t('Fixed price')}</FieldLabel>
                              <FormControl>
                                <InputGroup>
                                  <InputGroupAddon>$</InputGroupAddon>
                                  <InputGroupInput
                                    inputMode='decimal'
                                    placeholder='0.01'
                                    {...field}
                                    onChange={(event) => {
                                      const value = event.target.value
                                      if (numericDraftRegex.test(value)) {
                                        field.onChange(value)
                                      }
                                    }}
                                  />
                                  <InputGroupAddon align='inline-end'>
                                    {t('per request')}
                                  </InputGroupAddon>
                                </InputGroup>
                              </FormControl>
                              <FieldDescription>
                                {t(
                                  'Cost in USD per request, regardless of tokens used.'
                                )}
                              </FieldDescription>
                              <FormMessage />
                            </Field>
                          </FormItem>
                        )}
                      />
                    </FieldGroup>
                  </TabsContent>

                  <TabsContent value='tiered_expr' className='pt-0'>
                    <FieldGroup className='gap-5'>
                      {taskUsageSchema ? (
                        <TaskUsagePricingEditor
                          key={`${editorReloadToken}:${watchedValues.name}`}
                          billingExpr={resolvedBillingExpr}
                          requestRuleExpr={requestRuleExpr}
                          usageSchema={taskUsageSchema}
                          usageExamples={taskUsageExamples}
                          onBillingExprChange={setBillingExpr}
                          onRequestRuleExprChange={setRequestRuleExpr}
                        />
                      ) : (
                        <TieredPricingEditor
                          key={editorReloadToken}
                          modelName={watchedValues.name}
                          billingExpr={billingExpr}
                          requestRuleExpr={requestRuleExpr}
                          onBillingExprChange={setBillingExpr}
                          onRequestRuleExprChange={setRequestRuleExpr}
                        />
                      )}
                    </FieldGroup>
                  </TabsContent>
                </Tabs>

                {pricingMode !== 'tiered_expr' && (
                  <SettingsControlGroup className='space-y-3'>
                    <SettingsSwitchField
                      checked={discountEnabled}
                      onCheckedChange={handleDiscountToggle}
                      label={t('Show discount')}
                      description={t(
                        'Show a crossed-out regular price and discount badge on the public pricing page.'
                      )}
                      aria-label={t('Show discount')}
                    />
                    {discountEnabled && (
                      <div className='space-y-3'>
                        <Field>
                          <FieldLabel>{t('Discount')}</FieldLabel>
                          <InputGroup>
                            <InputGroupInput
                              inputMode='decimal'
                              value={discountPercent}
                              placeholder='10'
                              aria-label={t('Discount')}
                              onChange={(event) =>
                                handleDiscountChange(event.target.value)
                              }
                            />
                            <InputGroupAddon align='inline-end'>
                              %
                            </InputGroupAddon>
                          </InputGroup>
                        </Field>

                        {pricingMode === 'per-request' ? (
                          <Field>
                            <FieldLabel>{t('Regular price')}</FieldLabel>
                            <InputGroup>
                              <InputGroupAddon>$</InputGroupAddon>
                              <InputGroupInput
                                inputMode='decimal'
                                value={referencePriceDraft.request}
                                placeholder='0.02'
                                aria-label={t('Regular price')}
                                onChange={(event) =>
                                  handleReferencePriceChange(
                                    'request',
                                    event.target.value
                                  )
                                }
                              />
                              <InputGroupAddon align='inline-end'>
                                {t('per request')}
                              </InputGroupAddon>
                            </InputGroup>
                          </Field>
                        ) : (
                          <div className='grid gap-3 sm:grid-cols-2'>
                            <Field>
                              <FieldLabel>
                                {t('Regular input price')}
                              </FieldLabel>
                              <PriceInput
                                value={referencePriceDraft.input}
                                placeholder='3'
                                ariaLabel={t('Regular input price')}
                                onChange={(value) =>
                                  handleReferencePriceChange('input', value)
                                }
                              />
                            </Field>
                            <Field>
                              <FieldLabel>
                                {t('Regular output price')}
                              </FieldLabel>
                              <PriceInput
                                value={referencePriceDraft.output}
                                placeholder='15'
                                ariaLabel={t('Regular output price')}
                                onChange={(value) =>
                                  handleReferencePriceChange('output', value)
                                }
                              />
                            </Field>
                          </div>
                        )}

                        <FieldDescription>
                          {t(
                            'Enter exact regular prices, or change the discount to calculate them automatically. Billing still uses the final prices above.'
                          )}
                        </FieldDescription>
                        {discountError && (
                          <p className='text-destructive text-sm'>
                            {discountError}
                          </p>
                        )}
                      </div>
                    )}
                  </SettingsControlGroup>
                )}
              </FieldGroup>

              <aside className='bg-muted/20 sticky top-0 rounded-lg border'>
                <div className='border-b px-3 py-2'>
                  <div className='text-sm font-medium'>{t('Preview')}</div>
                </div>
                <div className='divide-y'>
                  {previewRows.map((row) => (
                    <div key={row.key} className='grid gap-1 px-3 py-2.5'>
                      <span className='text-muted-foreground text-xs'>
                        {row.label}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 text-sm',
                          row.multiline
                            ? 'font-mono text-xs leading-5 break-words whitespace-pre-wrap'
                            : 'truncate'
                        )}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
          {showActions && (
            <div className='bg-background/95 supports-[backdrop-filter]:bg-background/80 shrink-0 border-t p-3 backdrop-blur'>
              <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
                {onSave && (
                  <Button
                    type='button'
                    onClick={onSave}
                    disabled={isSaving}
                    className='w-full sm:w-auto'
                  >
                    <Save data-icon='inline-start' />
                    {isSaving ? t('Saving...') : t('Save model prices')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </form>
      </Form>
    </div>
  )
})
