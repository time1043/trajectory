import { createFileRoute, Link } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { Suspense } from 'react'

import { growthOverviewAtom } from '@/app/stores/growth'
import { allRowsAtom } from '@/app/stores/data'
import ActivityHeatmap from '@/components/activity-heatmap'
import EmptyState from '@/components/empty-state'
import HourDistribution from '@/components/hour-distribution'
import Loading from '@/components/loading'
import SessionItem from '@/components/session-item'
import StatStrip from '@/components/stat-strip'
import { fmtDate, fmtInt } from '@/lib/format'

export const Route = createFileRoute('/')({
  component: () => (
    <Suspense fallback={<Loading />}>
      <Dashboard />
    </Suspense>
  ),
})

function Dashboard() {
  const overview = useAtomValue(growthOverviewAtom)
  const rows = useAtomValue(allRowsAtom)

  if (!overview.firstAt || !overview.lastAt)
    return <EmptyState />

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <div className="slide-enter-content">
        <header>
          <h1 className="text-2xl font-medium text-hi">Overview</h1>
          <p className="mt-1.5 font-mono text-xs text-low">
            {fmtDate(overview.firstAt)}
            {' '}
            →
            {' '}
            {fmtDate(overview.lastAt)}
            {' '}
            ·
            {' '}
            {fmtInt(overview.totalSessions)}
            {' '}
            conversations
          </p>
        </header>

        <div className="mt-8">
          <StatStrip
            items={[
              { value: fmtInt(overview.totalSessions), label: 'conversations' },
              { value: fmtInt(overview.totalMessages), label: 'messages' },
              { value: `${overview.currentStreak} / ${overview.longestStreak}`, label: 'streak · now / longest' },
              { value: `${overview.activeDays} / ${overview.spanDays}`, label: 'active / span days' },
            ]}
          />
        </div>

        <section className="mt-12">
          <SectionTitle>活跃度</SectionTitle>
          <div className="mt-5">
            <ActivityHeatmap daily={overview.daily} firstAt={overview.firstAt} lastAt={overview.lastAt} />
          </div>
        </section>

        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <section>
            <SectionTitle>时段分布</SectionTitle>
            <p className="mt-1 font-mono text-xs text-faint">hour of day · local time</p>
            <div className="mt-5">
              <HourDistribution histogram={overview.hourHistogram} />
            </div>
          </section>

          <section>
            <SectionTitle>最近会话</SectionTitle>
            <div className="mt-3">
              {rows.length === 0
                ? <EmptyState />
                : rows.slice(0, 8).map(row => (
                  <SessionItem key={row.id} row={row} search={{}} />
                ))}
              {rows.length > 8 && (
                <Link
                  to="/sessions"
                  className="mt-3 inline-block font-mono text-xs text-low transition-colors duration-200 hover:text-hi"
                >
                  → 全部
                  {' '}
                  {fmtInt(rows.length)}
                  {' '}
                  个会话
                </Link>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-wider text-low uppercase select-none">
      {children}
    </h2>
  )
}
