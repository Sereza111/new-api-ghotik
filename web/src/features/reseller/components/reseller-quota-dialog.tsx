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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import type {
  ResellerQuotaAdjustmentMode,
  ResellerQuotaAdjustmentRequest,
} from '../types'

type ResellerQuotaDialogProps = {
  open: boolean
  keyName: string
  remainingTokens: number
  totalTokens: number
  baseCostPerMillion: number
  formatMoney: (value: number) => string
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onAdjust: (request: ResellerQuotaAdjustmentRequest) => Promise<boolean>
}

const MODES: ResellerQuotaAdjustmentMode[] = ['add', 'subtract', 'set']
const MODE_LABELS: Record<ResellerQuotaAdjustmentMode, string> = {
  add: 'Add quota',
  subtract: 'Subtract quota',
  set: 'Set total quota',
}

function toMillions(tokens: number): number {
  return Number((Math.max(0, tokens) / 1_000_000).toFixed(6))
}

export function ResellerQuotaDialog(props: ResellerQuotaDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ResellerQuotaAdjustmentMode>('add')
  const [amount, setAmount] = useState('')
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false)
  const pendingRequest = useRef<ResellerQuotaAdjustmentRequest | null>(null)
  const remainingMillions = toMillions(props.remainingTokens)
  const totalMillions = toMillions(props.totalTokens)
  const usedMillions = Math.max(0, totalMillions - remainingMillions)
  const parsedAmount = Number(amount)
  const minimumTotalMillions = Math.max(1, Math.ceil(usedMillions))

  let minimum = 1
  let maximum = 1000 - totalMillions
  if (mode === 'subtract') {
    maximum = Math.min(
      Math.floor(remainingMillions),
      totalMillions - minimumTotalMillions
    )
  }
  if (mode === 'set') {
    minimum = minimumTotalMillions
    maximum = 1000
  }

  const amountIsFinite = Number.isFinite(parsedAmount)
  const amountIsValid =
    amountIsFinite &&
    Number.isInteger(parsedAmount) &&
    parsedAmount >= minimum &&
    parsedAmount <= maximum

  let resultingTotalMillions = totalMillions
  if (amountIsFinite) {
    if (mode === 'add') resultingTotalMillions += parsedAmount
    if (mode === 'subtract') resultingTotalMillions -= parsedAmount
    if (mode === 'set') resultingTotalMillions = parsedAmount
  }
  const resultingRemainingMillions = Math.max(
    0,
    resultingTotalMillions - usedMillions
  )
  let paidDeltaMillions = 0
  if (amountIsValid && mode === 'add') paidDeltaMillions = parsedAmount
  if (amountIsValid && mode === 'set' && parsedAmount > totalMillions) {
    paidDeltaMillions = parsedAmount - totalMillions
  }
  const isPaidIncrease = paidDeltaMillions > 0
  const chargeAmount = paidDeltaMillions * props.baseCostPerMillion

  const reset = () => {
    setMode('add')
    setAmount('')
    setIsConfirmingPayment(false)
    pendingRequest.current = null
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !props.isSubmitting) reset()
    props.onOpenChange(open)
  }

  const handleSubmit = async () => {
    if (!amountIsValid || props.isSubmitting) return
    pendingRequest.current ??= {
      mode,
      token_millions: parsedAmount,
      expected_total_millions: totalMillions,
      request_id: crypto.randomUUID(),
    }
    const completed = await props.onAdjust(pendingRequest.current)
    if (completed) {
      reset()
      props.onOpenChange(false)
    }
  }

  const handlePrimaryAction = () => {
    if (!amountIsValid || props.isSubmitting) return
    if (isPaidIncrease && !isConfirmingPayment) {
      pendingRequest.current = {
        mode,
        token_millions: parsedAmount,
        expected_total_millions: totalMillions,
        request_id: crypto.randomUUID(),
      }
      setIsConfirmingPayment(true)
      return
    }
    void handleSubmit()
  }

  let primaryActionLabel = t('Update quota')
  if (props.isSubmitting) {
    primaryActionLabel = t('Updating quota...')
  } else if (isPaidIncrease && !isConfirmingPayment) {
    primaryActionLabel = t('Continue')
  } else if (isPaidIncrease) {
    primaryActionLabel = t('Confirm purchase')
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={t('Adjust quota for "{{name}}"', { name: props.keyName })}
      description={t(
        'Change the total token allocation for this reseller key.'
      )}
      contentHeight='auto'
      contentClassName='sm:max-w-lg'
      bodyClassName='space-y-5'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={props.isSubmitting}
            onClick={() => handleOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='button'
            disabled={!amountIsValid || props.isSubmitting}
            onClick={handlePrimaryAction}
          >
            {primaryActionLabel}
          </Button>
        </>
      }
    >
      <div className='grid grid-cols-2 gap-3 text-sm'>
        <div>
          <p className='text-muted-foreground'>{t('Remaining quota')}</p>
          <p className='mt-1 font-medium tabular-nums'>{remainingMillions}M</p>
        </div>
        <div>
          <p className='text-muted-foreground'>{t('Package limit')}</p>
          <p className='mt-1 font-medium tabular-nums'>{totalMillions}M</p>
        </div>
      </div>

      <p className='border-warning/40 bg-warning/5 text-muted-foreground border px-3 py-2 text-xs leading-5'>
        {t(
          'Adding quota charges your balance. Reducing quota does not refund funds.'
        )}
      </p>

      <div className='space-y-2'>
        <Label id='reseller-quota-mode-label'>{t('Operation')}</Label>
        <ToggleGroup
          value={[mode]}
          onValueChange={(values) => {
            const nextMode = values.find((value) => value !== mode) as
              | ResellerQuotaAdjustmentMode
              | undefined
            if (!nextMode) return
            setMode(nextMode)
            setAmount('')
            setIsConfirmingPayment(false)
            pendingRequest.current = null
          }}
          aria-labelledby='reseller-quota-mode-label'
          variant='outline'
          className='grid w-full grid-cols-3'
        >
          {MODES.map((item) => (
            <ToggleGroupItem key={item} value={item} className='min-w-0'>
              {t(MODE_LABELS[item])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='reseller-quota-amount'>{t('Million tokens')}</Label>
        <Input
          id='reseller-quota-amount'
          type='number'
          inputMode='numeric'
          min={minimum}
          max={maximum}
          step='1'
          value={amount}
          aria-invalid={amount.length > 0 && !amountIsValid}
          placeholder={t('Enter quota in millions of tokens')}
          disabled={props.isSubmitting}
          onChange={(event) => {
            setAmount(event.target.value)
            setIsConfirmingPayment(false)
            pendingRequest.current = null
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handlePrimaryAction()
          }}
        />
        <p className='text-muted-foreground text-xs'>
          {mode === 'set'
            ? t('Allowed total: {{min}}M to {{max}}M', {
                min: minimum,
                max: maximum,
              })
            : t('Maximum for this operation: {{amount}}M', {
                amount: Math.max(0, maximum),
              })}
        </p>
      </div>

      <div className='border-border grid grid-cols-2 gap-3 border-t pt-4 text-sm'>
        <div>
          <p className='text-muted-foreground'>{t('New package limit')}</p>
          <p className='mt-1 font-semibold tabular-nums'>
            {amountIsValid ? resultingTotalMillions : '—'}M
          </p>
        </div>
        <div>
          <p className='text-muted-foreground'>{t('New remaining quota')}</p>
          <p className='mt-1 font-semibold tabular-nums'>
            {amountIsValid
              ? Number(resultingRemainingMillions.toFixed(6))
              : '—'}
            M
          </p>
        </div>
      </div>

      {isConfirmingPayment && isPaidIncrease ? (
        <div
          role='alert'
          className='border-primary/40 bg-primary/5 space-y-3 border p-3'
        >
          <p className='font-medium'>{t('Confirm paid quota increase')}</p>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            <div>
              <p className='text-muted-foreground'>{t('Quota to add')}</p>
              <p className='mt-1 font-semibold tabular-nums'>
                {paidDeltaMillions}M
              </p>
            </div>
            <div>
              <p className='text-muted-foreground'>{t('Amount to charge')}</p>
              <p className='mt-1 font-semibold tabular-nums'>
                {props.formatMoney(chargeAmount)}
              </p>
            </div>
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t('This amount will be deducted from your balance immediately.')}
          </p>
        </div>
      ) : null}
    </Dialog>
  )
}
