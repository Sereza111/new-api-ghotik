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
import type { RoutingFamily, RoutingSource } from './types'

export type SourceRow = RoutingSource & {
  familyLabels: string[]
  selected: boolean
}

export function buildSourceRows(
  families: RoutingFamily[],
  sources: RoutingSource[]
): SourceRow[] {
  const familyInfoBySourceId = new Map<
    string,
    { labels: string[]; selected: boolean }
  >()

  for (const family of families) {
    for (const source of family.sources) {
      const sourceInfo = familyInfoBySourceId.get(source.id)
      if (sourceInfo) {
        sourceInfo.labels.push(family.label)
        sourceInfo.selected ||= family.selected_source_id === source.id
        continue
      }
      familyInfoBySourceId.set(source.id, {
        labels: [family.label],
        selected: family.selected_source_id === source.id,
      })
    }
  }

  return sources.map((source) => {
    const sourceInfo = familyInfoBySourceId.get(source.id)
    return {
      ...source,
      familyLabels: sourceInfo?.labels ?? [],
      selected: sourceInfo?.selected ?? false,
    }
  })
}
