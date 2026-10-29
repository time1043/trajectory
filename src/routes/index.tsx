import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import { allRowsAtom } from '@/app/stores/data'
import { growthOverviewAtom } from '@/app/stores/growth'
import { allTagCountsAtom } from '@/app/stores/tags'
import ActivityHeatmap from '@/components/activity-heatmap'
import EmptyState from '@/components/empty-state'
import HourDistribution from '@/components/hour-distribution'
import { withSuspense } from '@/components/loading'
import SessionItem from '@/components/session-item'
import StatStrip from '@/components/stat-strip'
import { fmtDate, fmtInt } from '@/lib/format'

export const Route = createFileRoute('/')({
  component: withSuspense(Dashboard),
})

function Dashboard() {
  const overview = useAtomValue(growthOverviewAtom)
  const rows = useAtomValue(allRowsAtom)

  if (!overview.firstAt || !overview.lastAt) return <EmptyState />

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <div className="slide-enter-content">
        <header>
          <h1 className="text-2xl font-medium text-hi">Overview</h1>
          <p className="mt-1.5 font-mono text-xs text-low">
            {fmtDate(overview.firstAt)} → {fmtDate(overview.lastAt)} ·{' '}
            {fmtInt(overview.totalSessions)} conversations
          </p>
        </header>

        <div className="mt-8">
          <StatStrip
            items={[
              { value: fmtInt(overview.totalSessions), label: 'conversations' },
              { value: fmtInt(overview.totalMessages), label: 'messages' },
              {
                value: `${overview.currentStreak} / ${overview.longestStreak}`,
                label: 'streak · now / longest',
              },
              {
                value: `${overview.activeDays} / ${overview.spanDays}`,
                label: 'active / span days',
              },
            ]}
          />
        </div>

        <TopTags />

        <section className="mt-12">
          <SectionTitle>Activity</SectionTitle>
          <div className="mt-5">
            <ActivityHeatmap
              daily={overview.daily}
              firstAt={overview.firstAt}
              lastAt={overview.lastAt}
            />
          </div>
        </section>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <section>
            <SectionTitle>Time of day</SectionTitle>
            <p className="mt-1 font-mono text-xs text-faint">hour of day · local time</p>
            <div className="mt-5">
              <HourDistribution histogram={overview.hourHistogram} />
            </div>
          </section>

          <section>
            <SectionTitle>Recent sessions</SectionTitle>
            <div className="mt-3">
              {rows.length === 0 ? (
                <EmptyState />
              ) : (
                rows.slice(0, 8).map((row) => <SessionItem key={row.id} row={row} search={{}} />)
              )}
              {rows.length > 8 && (
                <Link
                  to="/sessions"
                  className="mt-3 inline-block font-mono text-xs text-low transition-colors duration-200 hover:text-hi"
                >
                  All {fmtInt(rows.length)} sessions →
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The ten tags the user reaches for most — each links into the filtered list */
function TopTags() {
  const tagCounts = useAtomValue(allTagCountsAtom)
  const navigate = useNavigate()
  const top = useMemo(
    () => [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    [tagCounts],
  )
  if (!top.length) return null
  return (
    <section className="mt-12">
      <SectionTitle>Tags</SectionTitle>
      <div className="mt-4 flex flex-wrap gap-2">
        {top.map(([tag, count]) => (
          <button
            key={tag}
            type="button"
            onClick={() => void navigate({ to: '/sessions', search: { tags: tag } })}
            className="rounded-sm border border-line px-2 py-1 font-mono text-xs text-mid transition-colors duration-200 hover:text-hi"
            title={`Sessions tagged ${tag}`}
          >
            <span className="text-accent">#</span>
            {tag}
            <span className="ml-1.5 text-faint">{count}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-wider text-low uppercase select-none">
      {children}
    </h2>
  )
}
