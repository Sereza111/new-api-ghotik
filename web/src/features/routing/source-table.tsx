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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { buildSourceRows } from './source-rows'
import type { RoutingFamily, RoutingSource } from './types'

type SourceTableProps = {
  families: RoutingFamily[]
  sources: RoutingSource[]
}

export function SourceTable(props: SourceTableProps) {
  const { t, i18n } = useTranslation()
  const rows = buildSourceRows(props.families, props.sources)
  const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage || 'en', {
    maximumFractionDigits: 4,
  })

  return (
    <section
      aria-labelledby='routing-source-table-title'
      className='overflow-hidden rounded-lg border'
    >
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3'>
        <h2
          id='routing-source-table-title'
          className='font-serif text-base font-semibold'
        >
          {t('Available sources')}
        </h2>
        <span className='text-muted-foreground font-mono text-xs tabular-nums'>
          {rows.length}
        </span>
      </div>
      <Table className='min-w-180'>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Source')}</TableHead>
            <TableHead>{t('Description')}</TableHead>
            <TableHead>{t('Model families')}</TableHead>
            <TableHead className='text-end'>{t('Models')}</TableHead>
            <TableHead className='text-end'>{t('Price multiplier')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((source) => (
            <TableRow key={source.id}>
              <TableCell>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{source.label}</span>
                  {source.selected && (
                    <Badge variant='secondary'>{t('Selected')}</Badge>
                  )}
                  {source.is_default && (
                    <Badge variant='outline'>{t('Default')}</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className='text-muted-foreground max-w-96 whitespace-normal'>
                {source.description || t('No description provided.')}
              </TableCell>
              <TableCell>{source.familyLabels.join(', ') || '—'}</TableCell>
              <TableCell className='text-end font-mono tabular-nums'>
                {source.model_count}
              </TableCell>
              <TableCell className='text-end font-mono tabular-nums'>
                ×{numberFormatter.format(source.price_multiplier)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
