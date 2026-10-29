import { useEffect, useMemo } from 'react'

import type { TrajectoryRow } from '@/app/derive'
import type { SessionSearch } from '@/app/stores/session-filter'

import SessionItem from './session-item'

function groupKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}`
}

function groupLabel(at: number): string {
  const d = new Date(at)
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`
}

/** Grouped by start month (antfu's post-list year grouping, homologous); rows arrive updatedAt-desc */
export default function SessionList({
  rows,
  search,
  activeId,
}: {
  rows: readonly TrajectoryRow[]
  search: SessionSearch
  activeId?: string
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { at: number; rows: TrajectoryRow[] }>()
    for (const row of rows) {
      const key = groupKey(row.startedAt)
      const group = map.get(key) ?? { at: row.startedAt, rows: [] }
      group.rows.push(row)
      map.set(key, group)
    }
    return [...map.values()]
  }, [rows])

  // follow the active item after j/k or a click
  useEffect(() => {
    if (!activeId) return
    const el = document.querySelector(`[data-session-id="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div className="slide-enter-content pb-8">
      {groups.map((group) => (
        <div key={groupKey(group.at)}>
          <div className="px-3 pt-5 pb-1 font-mono text-xs text-faint select-none">
            {groupLabel(group.at)}
          </div>
          {group.rows.map((row) => (
            <div key={row.id} data-session-id={row.id}>
              <SessionItem row={row} search={search} active={row.id === activeId} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
