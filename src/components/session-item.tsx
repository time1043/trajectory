import { Link } from '@tanstack/react-router'

import type { TrajectoryRow } from '@/app/derive'
import { topicLabel } from '@/app/derive'
import type { SessionSearch } from '@/app/stores/sessions'
import { OTHER_TOPIC } from '@/domain/services/topics'
import ProviderDot from '@/components/provider-dot'

function shortDate(at: number): string {
  const d = new Date(at)
  return `${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}

export default function SessionItem({ row, search, active }: {
  row: TrajectoryRow
  search: SessionSearch
  active?: boolean
}) {
  return (
    <Link
      to="/sessions/$id"
      params={{ id: row.id }}
      search={search}
      className={`block border-l-2 py-2 pl-3 pr-3 transition-colors duration-150 ${
        active
          ? 'border-accent bg-elevated'
          : 'border-transparent hover:bg-elevated/60'}`}
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
