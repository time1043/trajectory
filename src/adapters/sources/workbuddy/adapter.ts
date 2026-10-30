import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter, SessionSummary } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import {
  buildTrajectory,
  fetchTexts,
  parseJsonl,
  toolPart,
  toolTitleFromInput,
  truncatedOutput,
  truncatedText,
  titleFromPrompt,
  type NodeDraft,
} from '../local/common'

interface WorkBuddyLine {
  id?: string
  timestamp?: number
  type?: string
  role?: string
  content?: unknown
  parentId?: string
  providerData?: { model?: string; modelId?: string; extra_fields?: { reasoning?: string } }
  aiTitle?: string
  sessionId?: string
  toolCallId?: string
  isError?: boolean
}

function readLines(text: string): WorkBuddyLine[] {
  return parseJsonl<WorkBuddyLine>(text).filter((l) => l.type && l.timestamp !== undefined)
}

function userParts(content: unknown): Part[] {
  const parts: Part[] = []
  if (typeof content === 'string') {
    if (content.trim()) parts.push(truncatedText(content))
    return parts
  }
  if (!Array.isArray(content)) return parts
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (
      (record.type === 'input_text' || record.type === 'text') &&
      typeof record.text === 'string' &&
      record.text.trim()
    )
      parts.push(truncatedText(record.text))
  }
  return parts
}

function assistantParts(content: unknown): Part[] {
  const parts: Part[] = []
  if (typeof content === 'string') {
    if (content.trim()) parts.push(truncatedText(content))
    return parts
  }
  if (!Array.isArray(content)) return parts
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (
      (record.type === 'output_text' || record.type === 'text') &&
      typeof record.text === 'string' &&
      record.text.trim()
    )
      parts.push(truncatedText(record.text))
  }
  return parts
}

function buildBody(
  lines: readonly WorkBuddyLine[],
  rawId: string,
  model: string | null,
): NodeDraft[] {
  const drafts: NodeDraft[] = []
  const pendingCalls = new Map<string, ToolCallPayload>()

  for (const line of lines) {
    const at = line.timestamp ?? 0

    if (line.type === 'message' && line.role === 'user') {
      const parts = userParts(line.content)
      if (!parts.length) continue
      drafts.push({ id: line.id ?? `${rawId}:u${drafts.length}`, at, role: 'user', parts })
    } else if (line.type === 'reasoning') {
      const text =
        (line.providerData?.extra_fields as { reasoning?: string })?.reasoning ??
        ((line as Record<string, unknown>).reasoning as string | undefined)
      if (text && typeof text === 'string') {
        const truncated = text.length > 8000 ? `${text.slice(0, 8000)}…` : text
        if (!drafts.length || drafts[drafts.length - 1].role !== 'assistant') {
          drafts.push({
            id: line.id ?? `${rawId}:r${drafts.length}`,
            at,
            role: 'assistant',
            model,
            parts: [{ kind: 'reasoning', text: truncated }],
          })
        } else {
          drafts[drafts.length - 1].parts.push({ kind: 'reasoning', text: truncated })
        }
      }
    } else if (line.type === 'function_call') {
      const toolName = String((line as Record<string, unknown>).name ?? 'tool')
      const args = (line as Record<string, unknown>).arguments
      const payload: ToolCallPayload = { title: toolTitleFromInput(args), input: args }
      pendingCalls.set(String(line.id ?? ''), payload)
      if (!drafts.length || drafts[drafts.length - 1].role !== 'assistant') {
        drafts.push({
          id: line.id ?? `${rawId}:t${drafts.length}`,
          at,
          role: 'assistant',
          model,
          parts: [],
        })
      }
      drafts[drafts.length - 1].parts.push(toolPart(toolName, payload))
    } else if (line.type === 'function_call_result') {
      const callId = line.toolCallId ?? ((line as Record<string, unknown>).id as string | undefined)
      const pending = typeof callId === 'string' ? pendingCalls.get(callId) : undefined
      if (pending) {
        const output =
          typeof line.content === 'string' ? line.content : JSON.stringify(line.content ?? '')
        Object.assign(pending, truncatedOutput(output))
        if (line.isError === true) pending.error = pending.error ?? 'error'
      }
    } else if (line.type === 'message' && line.role === 'assistant') {
      const parts = assistantParts(line.content)
      if (!parts.length) continue
      drafts.push({
        id: line.id ?? `${rawId}:a${drafts.length}`,
        at,
        role: 'assistant',
        model: (line.providerData?.model ?? model) as string | null,
        parts,
      })
    }
  }
  return drafts
}

export const workbuddyAdapter: SourceAdapter = {
  id: 'workbuddy',
  label: 'WorkBuddy',
  detect(manifest: SourceManifest): boolean {
    if (!manifest.dirName.includes('workbuddy')) return false
    return manifest.files.some((f) => f.path.includes('/projects/') && f.path.endsWith('.jsonl'))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'workbuddy', 'WorkBuddy')
    const sessionFiles = manifest.files.filter((f) => f.path.endsWith('.jsonl')).map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    const summaries: SessionSummary[] = []
    for (const [filePath, text] of texts) {
      const lines = readLines(text)
      const rawId = filePath.match(/([0-9a-f0-9-]+)\.jsonl$/)?.[1] ?? filePath

      let title = ''
      let firstPrompt = ''
      let startedAt = Number.POSITIVE_INFINITY
      let updatedAt = 0
      let previousRole: string | null = null
      const turnStarts: number[] = []
      let messageCount = 0
      let model: string | null = null

      for (const line of lines) {
        const at = line.timestamp ?? 0
        if (at) {
          startedAt = Math.min(startedAt, at)
          updatedAt = Math.max(updatedAt, at)
        }

        if (line.type === 'ai-title' && !title && typeof line.aiTitle === 'string') {
          title = line.aiTitle
          continue
        }
        if (line.type !== 'message') continue

        if (line.role === 'user') {
          const parts = userParts(line.content)
          // skip context-injection lines (system reminders etc.)
          const real = parts.filter(
            (p) =>
              p.kind === 'text' &&
              p.kind === 'text' &&
              !(p as { text: string }).text.startsWith('<'),
          )
          if (!real.length) continue
          messageCount++
          if (previousRole !== 'user') turnStarts.push(at)
          previousRole = 'user'
          if (!firstPrompt) {
            firstPrompt = (real[0] as { text: string }).text
          }
          if (!model) {
            model = (line.providerData?.model as string) ?? null
          }
        } else if (line.role === 'assistant') {
          messageCount++
          previousRole = 'assistant'
          if (!model) model = (line.providerData?.model as string) ?? null
        }
      }

      if (!turnStarts.length) continue
      summaries.push({
        id: `${identity.sourceId}:${rawId}`,
        sessionId: rawId,
        title: title || titleFromPrompt(firstPrompt) || '(untitled)',
        startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
        updatedAt,
        turnStarts,
        messageCount,
        firstPrompt,
      })
    }

    return {
      sourceId: identity.sourceId,
      provider: identity.provider,
      providerLabel: identity.providerLabel,
      user: identity.user,
      profile: null,
      sessions: summaries,
      diagnostics: { unknownPartCounts: {}, invariantViolations: [] },
    }
  },

  async loadSession({ manifest, fetchFile }, sessionId) {
    const identity = sourceIdentity(manifest, 'workbuddy', 'WorkBuddy')
    const file = manifest.files.find((f) => f.path.split('/').pop()?.includes(sessionId))
    if (!file) return null
    const lines = readLines(new TextDecoder().decode(await fetchFile(file.path)))
    const drafts = buildBody(lines, sessionId, null)
    if (!drafts.length) return null

    let title = ''
    let firstPrompt = ''
    for (const line of lines) {
      if (line.type === 'ai-title' && typeof line.aiTitle === 'string') {
        title = line.aiTitle
        break
      }
    }
    for (const draft of drafts) {
      if (draft.role !== 'user') continue
      const text = draft.parts.find((p) => p.kind === 'text')
      if (text && text.kind === 'text') {
        firstPrompt = text.text
        break
      }
    }

    let startedAt = Number.POSITIVE_INFINITY
    let updatedAt = 0
    for (const line of lines) {
      const at = line.timestamp ?? 0
      if (at) {
        startedAt = Math.min(startedAt, at)
        updatedAt = Math.max(updatedAt, at)
      }
    }

    return buildTrajectory({
      identity,
      rawId: sessionId,
      title: title || titleFromPrompt(firstPrompt) || '(untitled)',
      startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
      updatedAt,
      drafts,
    })
  },

  piiHints: ['line.cwd'],
}
