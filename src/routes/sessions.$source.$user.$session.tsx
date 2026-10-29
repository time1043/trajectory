import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { WebResult } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'
import type { DocBlock } from '@/domain/services/document-view'

import { sourcePartsAtom } from '@/app/stores/data'
import { documentViewFamily, trajectoryByIdFamily, variantPathsAtom } from '@/app/stores/detail'
import EmptyState from '@/components/empty-state'
import { withSuspense } from '@/components/loading'
import MiniToc, { type MiniTocEntry } from '@/components/mini-toc'
import ProviderDot from '@/components/provider-dot'
import PublishToggle from '@/components/publish-toggle'
import { MessageBlock, ReferenceList } from '@/components/session-parts'
import TagEditor from '@/components/tag-editor'
import { trajectoryIdFromParts } from '@/domain/model/identity'
import { fmtDate } from '@/lib/format'

export const Route = createFileRoute('/sessions/$source/$user/$session')({
  component: withSuspense(SessionDetail),
})

function SessionDetail() {
  const { source, user, session } = Route.useParams()
  const id = trajectoryIdFromParts(source, user, session)
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
  models: readonly string[]
}

function SessionContent({ trajectory, blocks, references, citationWindows, models }: ContentView) {
  const switched = useAtomValue(variantPathsAtom).has(trajectory.id)
  // one entry per real user turn — the reading view's table of contents
  const tocEntries = useMemo(() => {
    const entries: MiniTocEntry[] = []
    for (const block of blocks) {
      if (block.node.role !== 'user' || block.chainIndex !== 0) continue
      const text = block.node.parts.find((p) => p.kind === 'text')
      entries.push({
        id: `turn-${block.node.id}`,
        label:
          text && text.kind === 'text' ? text.text.split('\n')[0] : `turn ${entries.length + 1}`,
      })
    }
    return entries
  }, [blocks])
  // recognized sources always hit; raw segments are the fallback for safety
  const sourceParts = useAtomValue(sourcePartsAtom).get(trajectory.sourceId) ?? {
    providerLabel: trajectory.provider,
    user: trajectory.user,
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
        <ProviderDot sourceId={trajectory.provider} />
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
        <PublishToggle
          provider={trajectory.provider}
          user={trajectory.user}
          sessionId={trajectory.sessionId}
        />
      </div>

      <TagEditor trajectoryId={trajectory.id} shortcut />

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
      <MiniToc entries={tocEntries} />
    </div>
  )
}
