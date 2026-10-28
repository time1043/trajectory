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

export function truncate(text: string, cap: number, preview: number = cap): { text: string, truncated: boolean, originalChars: number } {
  if (text.length <= cap)
    return { text, truncated: false, originalChars: text.length }
  return { text: text.slice(0, Math.min(preview, cap)), truncated: true, originalChars: text.length }
}

export function toolPart(tool: string, payload: ToolCallPayload): Part {
  return { kind: 'tool-call', tool, payload }
}

export function truncatedOutput(output: string): ToolCallPayload {
  const { text, truncated, originalChars } = truncate(output, TOOL_OUTPUT_HARD_CAP_CHARS, TOOL_OUTPUT_PREVIEW_CHARS)
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
  if (!single)
    return ''
  return single.length > max ? `${single.slice(0, max)}…` : single
}

/** Pick the most display-worthy string from a tool input (command, path, pattern…) */
export function toolTitleFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object')
    return undefined
  const record = input as Record<string, unknown>
  const keys = ['command', 'description', 'title', 'file_path', 'path', 'pattern', 'query', 'url', 'name']
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      const single = value.replace(/\s+/g, ' ').trim()
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
  let previous: string | null = null
  for (const draft of drafts) {
    nodes.set(draft.id, {
      id: draft.id,
      parentId: previous,
      childIds: [],
      role: draft.role,
      model: draft.model ?? null,
      at: draft.at,
      parts: draft.parts,
    })
    previous = draft.id
  }
  return nodes
}

export function buildTrajectory(input: {
  sourceId: string
  rawId: string
  title: string
  startedAt: number
  updatedAt: number
  drafts: readonly NodeDraft[]
}): Trajectory {
  return {
    id: trajectoryId(input.sourceId, input.rawId),
    sourceId: input.sourceId,
    title: input.title || '(untitled)',
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    nodes: toNodes(input.drafts),
    activePath: input.drafts.map(d => d.id),
  }
}

export interface SourceBuild {
  trajectories: Trajectory[]
  unknownPartCounts: Record<string, number>
}

/** JSONL text -> parsed lines, skipping blanks; oversized lines still parse (truncation happens later) */
export function parseJsonl<T>(text: string): T[] {
  const lines: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim())
      continue
    try {
      lines.push(JSON.parse(line) as T)
    }
    catch {
      // a torn or non-JSON line is skipped, not fatal
    }
  }
  return lines
}

/** Fetch text files with bounded parallelism */
export async function fetchTexts(paths: readonly string[], fetchFile: (path: string) => Promise<ArrayBuffer>): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const BATCH = 8
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const settled = await Promise.all(batch.map(async (p) => {
      try {
        return [p, new TextDecoder().decode(await fetchFile(p))] as const
      }
      catch {
        return [p, ''] as const
      }
    }))
    for (const [p, text] of settled)
      results.set(p, text)
  }
  return results
}
