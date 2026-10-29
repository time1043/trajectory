import { useState } from 'react'

import type { AttachmentRef, Part, ToolCallPayload, WebResult } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'
import type { DocBlock } from '@/domain/services/document-view'
import type { VariantRef } from '@/domain/services/turn-builder'

import { useVariantSwitcher } from '@/app/stores/detail'
import { IconChevronLeft, IconChevronRight } from '@/components/icons'
import MarkdownRenderer from '@/components/markdown'
import { orderedSiblingsOf } from '@/domain/services/turn-builder'
import { fmtBytes, fmtChars, fmtLatency, fmtTime } from '@/lib/format'

/** Rendering blocks for the session reading view; the route file owns orchestration only. */
// ============ message blocks ============

export function MessageBlock({
  trajectory,
  block,
  references,
  citationWindow,
}: {
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

function BlockLabel({ role, node }: { role: 'YOU' | 'ASSISTANT'; node: DocBlock['node'] }) {
  return (
    <div className="font-mono text-[11px] tracking-wider text-low uppercase select-none">
      {role} · {fmtTime(node.at)}
    </div>
  )
}

function UserBlock({
  trajectory,
  block,
  onSwitch,
}: {
  trajectory: Trajectory
  block: DocBlock
  onSwitch: (variant: VariantRef) => void
}) {
  const { node, chainIndex, variant } = block
  const texts = node.parts.filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text')
  const attachments = node.parts.filter(
    (p): p is Extract<Part, { kind: 'attachment' }> => p.kind === 'attachment',
  )
  const rewritten = chainIndex > 0

  return (
    <div id={`turn-${node.id}`} className="tr-lazy-block scroll-mt-10">
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
      <div
        className={`mt-2 rounded-md border-l-2 py-3 pr-4 pl-4 ${
          rewritten
            ? 'border-line bg-elevated/50 text-sm text-low'
            : 'border-accent bg-accent-soft text-hi/90'
        }`}
      >
        {texts.map((part, i) => (
          <div key={i} className={`${i > 0 ? 'mt-3' : ''} whitespace-pre-wrap`}>
            {part.text}
          </div>
        ))}
        {attachments.map((part, i) => (
          <FileChips key={i} files={part.files} />
        ))}
      </div>
    </div>
  )
}

function AssistantBlock({
  trajectory,
  block,
  references,
  citationWindow,
  onSwitch,
}: {
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

function VariantPager({
  trajectory,
  variant,
  nodeId,
  onSwitch,
}: {
  trajectory: Trajectory
  variant: NonNullable<DocBlock['variant']>
  nodeId: string
  onSwitch: (variant: VariantRef) => void
}) {
  const ordered = orderedSiblingsOf(trajectory, nodeId)
  if (ordered.length <= 1) return null
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
        {variant.index}/{variant.count}
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

function PartRenderer({
  part,
  references,
  citationWindow,
}: {
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
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 font-mono text-xs text-low transition-colors duration-150 hover:text-hi"
      >
        <span
          className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
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

/** Collapsed one-liner per tool call; expands to the (truncated) output */
function ToolBlock({ tool, payload }: { tool: string; payload?: unknown }) {
  const [open, setOpen] = useState(false)
  const p = (payload ?? {}) as ToolCallPayload
  const label = p.title ? `${tool} · ${p.title}` : tool

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 font-mono text-xs transition-colors duration-150 ${p.error ? 'text-error-strong' : 'text-low hover:text-hi'}`}
      >
        <span
          className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="truncate">{label}</span>
        {p.error && <span className="text-faint">· failed</span>}
      </button>
      {open && p.output && (
        <div className="mt-2 border-l border-line pl-4">
          <pre className="max-h-96 max-w-full overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-mid">
            {p.output}
          </pre>
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
  if (results.length === 0) return null
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 font-mono text-xs text-low transition-colors duration-150 hover:text-hi"
      >
        <span
          className={`inline-block text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        ⌕ web search
        <span className="text-faint">· {results.length} results</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-l border-line pl-4">
          {results.map((r, i) => (
            <li key={`${r.url}-${i}`} className="truncate font-mono text-xs">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-mid transition-colors duration-150 hover:text-accent"
              >
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
  if (files.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {files.map((file) => (
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
  return <div className="mt-3 font-mono text-xs text-faint select-none">{label}</div>
}

// ============ references (single session-level footnote) ============

export function ReferenceList({ references }: { references: readonly WebResult[] }) {
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
  } catch {
    return url
  }
}
