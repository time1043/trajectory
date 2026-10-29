import { createFileRoute, Link } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { TrajectoryRow } from '@/app/derive'

import { allRowsAtom } from '@/app/stores/data'
import EmptyState from '@/components/empty-state'
import { withSuspense } from '@/components/loading'
import MiniToc from '@/components/mini-toc'
import ProviderDot from '@/components/provider-dot'
import { MONTH_SHORT, fmtDate, fmtInt } from '@/lib/format'

export const Route = createFileRoute('/timeline')({
  component: withSuspense(Timeline),
})

function Timeline() {
  const rows = useAtomValue(allRowsAtom)
  const years = useMemo(() => {
    // rows arrive updatedAt-desc; the timeline groups by startedAt to read as "how it happened"
    const sorted = [...rows].sort((a, b) => b.startedAt - a.startedAt)
    const byYear = new Map<number, TrajectoryRow[]>()
    for (const row of sorted) {
      const year = new Date(row.startedAt).getFullYear()
      const list = byYear.get(year) ?? []
      list.push(row)
      byYear.set(year, list)
    }
    return [...byYear.entries()]
  }, [rows])

  const yearEntries = useMemo(
    () => years.map(([year]) => ({ id: `timeline-year-${year}`, label: String(year) })),
    [years],
  )

  if (!rows.length) return <EmptyState />

  const first = rows[rows.length - 1]
  const last = rows[0]

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 md:px-8">
      <div className="slide-enter-content">
        <header>
          <h1 className="text-2xl font-medium text-hi">Timeline</h1>
          <p className="mt-1.5 font-mono text-xs text-low">
            {fmtInt(rows.length)} conversations · {fmtDate(first.startedAt)} →{' '}
            {fmtDate(last.startedAt)}
          </p>
        </header>

        <div className="relative mt-10 border-l border-line pl-6">
          {years.map(([year, yearRows]) => (
            <section key={year} id={`timeline-year-${year}`} className="scroll-mt-8 pb-6">
              <h2 className="slide-enter -ml-6 pt-2 text-3xl font-medium text-hi">{year}</h2>
              <MonthGroups rows={yearRows} />
            </section>
          ))}
        </div>
        <MiniToc entries={yearEntries} minCount={2} />
      </div>
    </div>
  )
}

function MonthGroups({ rows }: { rows: readonly TrajectoryRow[] }) {
  const months = useMemo(() => {
    const byMonth = new Map<string, TrajectoryRow[]>()
    for (const row of rows) {
      const d = new Date(row.startedAt)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const list = byMonth.get(key) ?? []
      list.push(row)
      byMonth.set(key, list)
    }
    return [...byMonth.values()]
  }, [rows])

  return (
    <div className="mt-4 space-y-6">
      {months.map((monthRows) => (
        <div key={monthRows[0].startedAt}>
          {(() => {
            const d = new Date(monthRows[0].startedAt)
            return (
              <div className="font-mono text-xs text-faint select-none">
                {MONTH_SHORT[d.getMonth()]} {d.getFullYear()} · {monthRows.length}
              </div>
            )
          })()}
          <ul className="mt-2">
            {monthRows.map((row) => (
              <li key={row.id} className="group flex items-baseline gap-3 py-1">
                <span className="w-11 shrink-0 font-mono text-xs text-low tabular-nums">
                  {fmtDate(row.startedAt).slice(5)}
                </span>
                <Link
                  to="/sessions/$source/$user/$session"
                  params={{ source: row.provider, user: row.user, session: row.sessionId }}
                  className="min-w-0 flex-1 truncate text-sm text-mid transition-colors duration-200 group-hover:text-hi"
                >
                  {row.title}
                </Link>
                <ProviderDot sourceId={row.sourceId} className="translate-y-[1px]" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
