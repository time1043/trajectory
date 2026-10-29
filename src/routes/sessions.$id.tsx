import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'

import type { ModelId } from '@/domain/model/identity'
import type { WebResult } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'
import type { DocBlock } from '@/domain/services/document-view'

import { sourcePartsAtom } from '@/app/stores/data'
import { documentViewFamily, trajectoryByIdFamily, variantPathsAtom } from '@/app/stores/detail'
import EmptyState from '@/components/empty-state'
import { withSuspense } from '@/components/loading'
import ProviderDot from '@/components/provider-dot'
import { MessageBlock, ReferenceList } from '@/components/session-parts'
import { fmtDate } from '@/lib/format'

export const Route = createFileRoute('/sessions/$id')({
  component: withSuspense(SessionDetail),
})

function SessionDetail() {
  const { id } = Route.useParams()
  const view = useAtomValue(documentViewFamily(id))
  const trajectory = useAtomValue(trajectoryByIdFamily(id))

  if (!view || !trajectory) return <EmptyState>{'{ session not found }'}</EmptyState>

  return (
    <SessionContent
      key={trajectory.id}
      trajectory={trajectory}
      blocks={view.blocks}
      references={view.references}
      citationWindows={view.citationWindows}
      models={view.models}
    />
  )
}

interface ContentView {
  trajectory: Trajectory
  blocks: readonly DocBlock[]
  references: readonly WebResult[]
  citationWindows: ReadonlyMap<string, readonly WebResult[]>
  models: readonly ModelId[]
}

function SessionContent({ trajectory, blocks, references, citationWindows, models }: ContentView) {
  const switched = useAtomValue(variantPathsAtom).has(trajectory.id)
  const sourceParts = useAtomValue(sourcePartsAtom).get(trajectory.sourceId) ?? {
    providerLabel: trajectory.sourceId,
    user: '',
  }
  const userCount = blocks.filter((b) => b.node.role === 'user' && b.chainIndex === 0).length

  return (
    // key = path hash: after a variant switch the whole path re-renders as one
    // continuous document; unchanged prefix keys let React reuse blocks, and
    // switched conversations get a 150ms crossfade
    <div className={`mx-auto max-w-3xl px-6 py-10 md:px-8 ${switched ? 'tr-fade-in' : ''}`}>
      <h1 className="text-2xl leading-snug font-medium text-hi">{trajectory.title}</h1>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-low">
        <span>{fmtDate(trajectory.startedAt)}</span>
        <span className="text-faint">·</span>
        <span>{userCount} turns</span>
        <span className="text-faint">·</span>
        <span>{blocks.length} messages</span>
        <span className="text-faint">·</span>
        <ProviderDot sourceId={trajectory.sourceId} />
        <span>{sourceParts.providerLabel}</span>
        {models.length > 0 && (
          <>
            <span className="text-faint">·</span>
            <span className="text-mid">{models.join(' + ')}</span>
          </>
        )}
        {sourceParts.user && (
          <>
            <span className="text-faint">·</span>
            <span>{sourceParts.user}</span>
          </>
        )}
      </div>

      <div className="mt-10 space-y-9">
        {blocks.map((block) => (
          <MessageBlock
            key={block.node.id}
            trajectory={trajectory}
            block={block}
            references={references}
            citationWindow={citationWindows.get(block.node.id)}
          />
        ))}
      </div>

      {references.length > 0 && <ReferenceList references={references} />}
    </div>
  )
}
