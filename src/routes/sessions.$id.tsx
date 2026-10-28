import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { Suspense, useState } from 'react'

import { documentViewFamily, trajectoryByIdFamily, useVariantSwitcher, variantPathsAtom } from '@/app/stores/detail'
import type { Trajectory } from '@/domain/model/trajectory'
import type { DocBlock } from '@/domain/services/document-view'
import type { AttachmentRef, Part, WebResult } from '@/domain/model/part'
import type { VariantRef } from '@/domain/services/turn-builder'
import { orderedSiblingsOf } from '@/domain/services/turn-builder'
import EmptyState from '@/components/empty-state'
import { IconChevronLeft, IconChevronRight } from '@/components/icons'
import MarkdownRenderer from '@/components/markdown'
import ProviderDot from '@/components/provider-dot'
import { fmtBytes, fmtChars, fmtDate, fmtLatency, fmtTime } from '@/lib/format'
import Loading from '@/components/loading'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetailSuspense,
})

function SessionDetailSuspense() {
  return (
    <Suspense fallback={<Loading />}>
      <SessionDetail />
    </Suspense>
  )
}

function SessionDetail() {
  const { id } = Route.useParams()
  const view = useAtomValue(documentViewFamily(id))
  const trajectory = useAtomValue(trajectoryByIdFamily(id))

  if (!view || !trajectory)
    return <EmptyState>{'{ session not found }'}</EmptyState>

  return <SessionContent key={trajectory.id} trajectory={trajectory} blocks={view.blocks} references={view.references} citationWindows={view.citationWindows} />
}

interface ContentView {
  trajectory: Trajectory
  blocks: readonly DocBlock[]
  references: readonly WebResult[]
  citationWindows: ReadonlyMap<string, readonly WebResult[]>
}

function SessionContent({ trajectory, blocks, references, citationWindows }: ContentView) {
  const switched = useAtomValue(variantPathsAtom).has(trajectory.id)
  const userCount = blocks.filter(b => b.node.role === 'user' && b.chainIndex === 0).length

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
        <span>{trajectory.sourceId}</span>
      </div>

      <div className="mt-10 space-y-9">
        {blocks.map(block => (
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

// ============ message blocks ============

function MessageBlock({ trajectory, block, references, citationWindow }: {
  trajectory: Trajectory
  block: DocBlock
  references: readonly WebResult[]
  citationWindow: readonly WebResult[] | undefined
}) {
  const switchVariant = useVariantSwitcher(trajectory.id)
  if (block.node.role === 'user')
    return <UserBlock trajectory={trajectory} block={block} onSwitch={switchVariant} />
  return (
    <AssistantBlock
      trajectory={trajectory}
      block={block}
      references={references}
      citationWindow={citationWindow}
      onSwitch={switchVariant}
    />
  )
}

function BlockLabel({ role, node }: { role: 'YOU' | 'ASSISTANT', node: DocBlock['node'] }) {
  return (
    <div className="font-mono text-[11px] tracking-wider text-low uppercase select-none">
      {role}
      {' '}
      ·
      {' '}
      {fmtTime(node.at)}
    </div>
  )
}

function UserBlock({ trajectory, block, onSwitch }: {
  trajectory: Trajectory
  block: DocBlock
  onSwitch: (variant: VariantRef) => void
}) {
  const { node, chainIndex, variant } = block
  const texts = node.parts.filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text')
  const attachments = node.parts.filter((p): p is Extract<Part, { kind: 'attachment' }> => p.kind === 'attachment')
  const rewritten = chainIndex > 0

  return (
    <div className="tr-lazy-block">
      <div className="flex items-center gap-2.5">
        <BlockLabel role="YOU" node={node} />
        {rewritten && (
          <span className="rounded-xs border border-line px-1 font-mono text-[10px] text-faint select-none">
            rewritten #{chainIndex}
          </span>
        )}
        {variant && variant.count > 1 && (
          <VariantPager
            trajectory={trajectory}
            variant={variant}
            nodeId={node.id}
            onSwitch={onSwitch}
          />
        )}
      </div>
      {texts.map((part, i) => (
        <div
          key={i}
          className={`mt-2 border-l-2 pl-4 whitespace-pre-wrap ${
            rewritten ? 'border-line text-low text-sm' : 'border-line-strong text-hi/85'}`}
        >
          {part.text}
        </div>
      ))}
      {attachments.map((part, i) => (
        <FileChips key={i} files={part.files} />
      ))}
    </div>
  )
}

function AssistantBlock({ trajectory, block, references, citationWindow, onSwitch }: {
  trajectory: Trajectory
  block: DocBlock
  references: readonly WebResult[]
  citationWindow: readonly WebResult[] | undefined
  onSwitch: (variant: VariantRef) => void
}) {
  const { node, variant, latencyMs } = block

  return (
    <div className="tr-lazy-block">
      <div className="flex items-center gap-2.5">
        <BlockLabel role="ASSISTANT" node={node} />
        {latencyMs !== null && latencyMs > 1000 && (
          <span className="font-mono text-[11px] text-faint">{fmtLatency(latencyMs)}</span>
        )}
        {variant && variant.count > 1 && (
          <VariantPager
            trajectory={trajectory}
            variant={variant}
            nodeId={node.id}
            onSwitch={onSwitch}
          />
        )}
      </div>
      <div className="mt-1.5">
        {node.parts.map((part, i) => (
          <PartRenderer
            key={i}
            part={part}
            references={references}
            citationWindow={citationWindow}
          />
        ))}
      </div>
    </div>
  )
}

function VariantPager({ trajectory, variant, nodeId, onSwitch }: {
  trajectory: Trajectory
  variant: NonNullable<DocBlock['variant']>
  nodeId: string
  onSwitch: (variant: VariantRef) => void
}) {
  const ordered = orderedSiblingsOf(trajectory, nodeId)
  if (ordered.length <= 1)
    return null
  const idx = variant.index - 1
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  const next = ordered[(idx + 1) % ordered.length]

  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm border border-line font-mono text-[11px] text-low select-none">
      <button
        type="button"
        onClick={() => onSwitch({ nodeId: prev, siblingOf: nodeId })}
        className="px-1.5 py-0.5 transition-colors duration-150 hover:text-hi"
        aria-label="Previous variant"
      >
        <IconChevronLeft className="size-3" />
      </button>
      <span className="tabular-nums">
        {variant.index}
        /
        {variant.count}
      </span>
      <button
        type="button"
        onClick={() => onSwitch({ nodeId: next, siblingOf: nodeId })}
        className="px-1.5 py-0.5 transition-colors duration-150 hover:text-hi"
        aria-label="Next variant"
      >
        <IconChevronRight className="size-3" />
      </button>
    </span>
  )
}

// ============ part rendering ============

function PartRenderer({ part, references, citationWindow }: {
  part: Part
  references: readonly WebResult[]
  citationWindow: readonly WebResult[] | undefined
}) {
  switch (part.kind) {
    case 'text':
      return <MarkdownRenderer text={part.text} window={citationWindow} references={references} />
    case 'reasoning':
      return <ThinkBlock text={part.text} />
    case 'search':
      return <SearchBlock results={part.results} />
    case 'attachment':
      return <FileChips files={part.files} />
    case 'tool-call':
      return <ToolBlock tool={part.tool} payload={part.payload} />
    case 'unknown':
      return <ToolChip label={`? ${part.rawType}`} />
  }
}

function ThinkBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 font-mono text-xs text-low transition-colors duration-150 hover:text-hi"
      >
        <span className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        Thinking
        <span className="text-faint">· {fmtChars(text.length)} chars</span>
      </button>
      {open && (
        <div className="mt-2 border-l border-line pl-4 text-sm leading-7 whitespace-pre-wrap text-mid">
          {text}
        </div>
      )}
    </div>
  )
}

export interface ToolCallPayload {
  title?: string
  input?: unknown
  output?: string
  truncated?: boolean
  originalChars?: number
  error?: string
}

/** Collapsed one-liner per tool call; expands to the (truncated) output */
function ToolBlock({ tool, payload }: { tool: string, payload?: unknown }) {
  const [open, setOpen] = useState(false)
  const p = (payload ?? {}) as ToolCallPayload
  const label = p.title ? `${tool} · ${p.title}` : tool

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 font-mono text-xs transition-colors duration-150 ${p.error ? 'text-error-strong' : 'text-low hover:text-hi'}`}
      >
        <span className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="truncate">{label}</span>
        {p.error && <span className="text-faint">· failed</span>}
      </button>
      {open && p.output && (
        <div className="mt-2 border-l border-line pl-4">
          <pre className="max-h-96 max-w-full overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-mid">{p.output}</pre>
          {p.truncated && p.originalChars !== undefined && (
            <div className="mt-1 font-mono text-[10px] text-faint select-none">
              truncated · original {fmtChars(p.originalChars)} chars
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchBlock({ results }: { results: readonly WebResult[] }) {
  const [open, setOpen] = useState(false)
  if (results.length === 0)
    return null
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 font-mono text-xs text-low transition-colors duration-150 hover:text-hi"
      >
        <span className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        ⌕ web search
        <span className="text-faint">· {results.length} results</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-l border-line pl-4">
          {results.map((r, i) => (
            <li key={`${r.url}-${i}`} className="truncate font-mono text-xs">
              <a href={r.url} target="_blank" rel="noreferrer" className="text-mid transition-colors duration-150 hover:text-accent">
                {r.title || r.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FileChips({ files }: { files: readonly AttachmentRef[] }) {
  if (files.length === 0)
    return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {files.map(file => (
        <span
          key={file.fileId}
          className="max-w-full truncate rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-low"
          title={`${file.fileName} · ${fmtBytes(file.fileSize)}`}
        >
          ⎙ {file.fileName}
          <span className="ml-1 text-faint">{fmtBytes(file.fileSize)}</span>
        </span>
      ))}
    </div>
  )
}

function ToolChip({ label }: { label: string }) {
  return (
    <div className="mt-3 font-mono text-xs text-faint select-none">
      {label}
    </div>
  )
}

// ============ references (single session-level footnote) ============

function ReferenceList({ references }: { references: readonly WebResult[] }) {
  return (
    <div className="mt-14 border-t border-line pt-5">
      <div className="font-mono text-[11px] tracking-wider text-low uppercase select-none">
        References
      </div>
      <ol className="mt-3 space-y-1.5">
        {references.map((ref, i) => (
          <li key={`${ref.url}-${i}`} id={`ref-${i + 1}`} className="flex gap-2 font-mono text-xs">
            <span className="shrink-0 text-accent tabular-nums">[{i + 1}]</span>
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate text-mid transition-colors duration-150 hover:text-accent"
              title={ref.url}
            >
              {ref.title || ref.url}
              <span className="ml-1.5 text-faint">{hostname(ref.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  }
  catch {
    return url
  }
}
