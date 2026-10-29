import { Link } from '@tanstack/react-router'

import type { TrajectoryRow } from '@/app/derive'
import type { SessionSearch } from '@/app/stores/session-filter'

import { topicLabel } from '@/app/derive'
import ProviderDot from '@/components/provider-dot'
import { OTHER_TOPIC } from '@/domain/services/topics'

function shortDate(at: number): string {
  const d = new Date(at)
  return `${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}

export default function SessionItem({
  row,
  search,
  active,
}: {
  row: TrajectoryRow
  search: SessionSearch
  active?: boolean
}) {
  return (
    <Link
      to="/sessions/$source/$user/$session"
      params={{ source: row.provider, user: row.user, session: row.sessionId }}
      search={search}
      className={`block border-l-2 py-2 pr-3 pl-3 transition-colors duration-150 ${
        active ? 'border-accent bg-elevated' : 'border-transparent hover:bg-elevated/60'
      }`}
    >
      <div className="truncate text-sm text-hi/90">{row.title}</div>
      <div className="mt-1 flex items-center gap-1.5 font-mono text-xs text-low">
        <span>{shortDate(row.updatedAt)}</span>
        <span className="text-faint">·</span>
        <span>{row.turnCount} turns</span>
        <span className="text-faint">·</span>
        <ProviderDot sourceId={row.sourceId} />
        {row.primaryTopic !== OTHER_TOPIC && (
          <>
            <span className="text-faint">·</span>
            <span className="truncate text-low">{topicLabel(row.primaryTopic)}</span>
          </>
        )}
      </div>
    </Link>
  )
}
