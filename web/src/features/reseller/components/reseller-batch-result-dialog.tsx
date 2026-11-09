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
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import type { ResellerKey } from '../types'

type ResellerBatchResultDialogProps = {
  keys: ResellerKey[]
  onClose: () => void
}

export function ResellerBatchResultDialog(
  props: ResellerBatchResultDialogProps
) {
  const { t } = useTranslation()
  const keyList = props.keys.map((key) => key.key).join('\n')

  const handleDownload = () => {
    const blob = new Blob([`${keyList}\n`], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `reseller-keys-${Date.now()}.txt`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Reseller keys issued')}
      description={t('Created {{count}} reseller keys.', {
        count: props.keys.length,
      })}
      contentClassName='sm:max-w-xl'
      contentHeight='min(50vh, 24rem)'
      bodyClassName='space-y-3'
      footer={
        <>
          <CopyButton
            value={keyList}
            variant='outline'
            size='default'
            aria-label={t('Copy all keys')}
          >
            {t('Copy all keys')}
          </CopyButton>
          <Button type='button' variant='outline' onClick={handleDownload}>
            <Download data-icon='inline-start' aria-hidden='true' />
            {t('Download TXT')}
          </Button>
          <Button type='button' onClick={props.onClose}>
            {t('Done')}
          </Button>
        </>
      }
    >
      <p className='text-muted-foreground text-sm leading-5'>
        {t('Copy or download this batch for your sales slots.')}
      </p>
      <ol className='divide-border overflow-hidden border'>
        {props.keys.map((key, index) => (
          <li
            key={key.id}
            className='flex min-w-0 items-center gap-3 border-b px-3 py-2 last:border-b-0'
          >
            <span className='text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums'>
              {index + 1}.
            </span>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-xs font-medium'>{key.client_label}</p>
              <code className='block truncate text-xs'>{key.key}</code>
            </div>
            <CopyButton
              value={key.key}
              tooltip={t('Copy key')}
              aria-label={t('Copy key')}
            />
          </li>
        ))}
      </ol>
    </Dialog>
  )
}
