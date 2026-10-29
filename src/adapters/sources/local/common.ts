import type { NodeId } from '@/domain/model/identity'
import type { SourceIdentity } from '@/domain/ports/source-adapter'
import type { MessageNode, Role } from '@/domain/model/message-node'
import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'

import { trajectoryId } from '@/domain/model/identity'

/**
 * Shared conventions for local coding-agent adapters. Giant tool outputs and
 * reasoning chains are truncated (single multi-MB lines must never reach the
 * renderer), titles fall back to the first real user prompt, and the message
 * tree is linear because CLI logs have no branches.
 */

export const TOOL_OUTPUT_PREVIEW_CHARS = 2000
export const TOOL_OUTPUT_HARD_CAP_CHARS = 16_000
export const REASONING_CAP_CHARS = 8000
export const TEXT_HARD_CAP_CHARS = 32_000

export function truncate(
  text: string,
  cap: number,
  preview: number = cap,
): { text: string; truncated: boolean; originalChars: number } {
  if (text.length <= cap) return { text, truncated: false, originalChars: text.length }
  return {
    text: text.slice(0, Math.min(preview, cap)),
    truncated: true,
    originalChars: text.length,
  }
}

export function toolPart(tool: string, payload: ToolCallPayload): Part {
  return { kind: 'tool-call', tool, payload }
}

export function truncatedOutput(output: string): ToolCallPayload {
  const { text, truncated, originalChars } = truncate(
    output,
    TOOL_OUTPUT_HARD_CAP_CHARS,
    TOOL_OUTPUT_PREVIEW_CHARS,
  )
  return { output: text, truncated, originalChars }
}

export function truncatedReasoning(text: string): Part {
  return { kind: 'reasoning', text: truncate(text, REASONING_CAP_CHARS).text }
}

export function truncatedText(text: string): Part {
  return { kind: 'text', text: truncate(text, TEXT_HARD_CAP_CHARS).text }
}

/** Collapse whitespace so a first prompt can serve as a one-line title */
export function titleFromPrompt(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (!single) return ''
  return single.length > max ? `${single.slice(0, max)}…` : single
}

/** Pick the most display-worthy string from a tool input (command, path, pattern…) */
export function toolTitleFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  const keys = [
    'command',
    'cmd',
    'description',
    'title',
    'file_path',
    'path',
    'pattern',
    'query',
    'url',
    'name',
  ]
  for (const key of keys) {
    const value = record[key]
    // codex exec_command carries argv arrays — join them into a readable line
    const candidate = Array.isArray(value)
      ? value.filter((v) => typeof v === 'string').join(' ')
      : value
    if (typeof candidate === 'string' && candidate.trim()) {
      const single = candidate.replace(/\s+/g, ' ').trim()
      return single.length > 60 ? `${single.slice(0, 60)}…` : single
    }
  }
  return undefined
}

export interface NodeDraft {
  id: string
  at: number
  role: Role
  model?: string | null
  parts: Part[]
}

/** Assemble drafts into the flat node map, parent-linked in insertion order */
export function toNodes(drafts: readonly NodeDraft[]): Map<string, MessageNode> {
  const nodes = new Map<string, MessageNode>()
  let previousId: string | null = null
  let previousChildIds: NodeId[] | null = null
  for (const draft of drafts) {
    const childIds: NodeId[] = []
    nodes.set(draft.id, {
      id: draft.id,
      parentId: previousId,
      childIds,
      role: draft.role,
      model: draft.model ?? null,
      at: draft.at,
      parts: draft.parts,
    })
    previousChildIds?.push(draft.id)
    previousId = draft.id
    previousChildIds = childIds
  }
  return nodes
}

export function buildTrajectory(input: {
  identity: SourceIdentity
  rawId: string
  title: string
  startedAt: number
  updatedAt: number
  drafts: readonly NodeDraft[]
}): Trajectory {
  const { identity, rawId } = input
  return {
    id: trajectoryId(identity.sourceId, rawId),
    sourceId: identity.sourceId,
    provider: identity.provider,
    user: identity.user,
    sessionId: rawId,
    title: input.title || '(untitled)',
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    nodes: toNodes(input.drafts),
    activePath: input.drafts.map((d) => d.id),
  }
}

/** Shared tail for file-based adapters: explicit title first, prompt fallback, time fallbacks */
export function finishSession(input: {
  identity: SourceIdentity
  rawId: string
  drafts: readonly NodeDraft[]
  startedAt: number
  updatedAt: number
  title?: string
  firstPrompt?: string
}): Trajectory | null {
  if (!input.drafts.length) return null
  const startedAt = input.startedAt === Number.POSITIVE_INFINITY ? input.updatedAt : input.startedAt
  const title = input.title || titleFromPrompt(input.firstPrompt ?? '') || ''
  return buildTrajectory({ ...input, title, startedAt })
}

/** Extract a session uuid from a jsonl path, falling back to the full path */
export function uuidFromPath(path: string): string {
  return (
    path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1] ??
    path
  )
}

export interface SourceBuild {
  trajectories: Trajectory[]
  unknownPartCounts: Record<string, number>
}

/** JSONL text -> parsed lines, skipping blanks; oversized lines still parse (truncation happens later) */
export function parseJsonl<T>(text: string): T[] {
  const lines: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      lines.push(JSON.parse(line) as T)
    } catch {
      // a torn or non-JSON line is skipped, not fatal
    }
  }
  return lines
}

/** Fetch text files with bounded parallelism */
export async function fetchTexts(
  paths: readonly string[],
  fetchFile: (path: string) => Promise<ArrayBuffer>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const BATCH = 8
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const settled = await Promise.all(
      batch.map(async (p) => {
        try {
          return [p, new TextDecoder().decode(await fetchFile(p))] as const
        } catch {
          return [p, ''] as const
        }
      }),
    )
    for (const [p, text] of settled) results.set(p, text)
  }
  return results
}
