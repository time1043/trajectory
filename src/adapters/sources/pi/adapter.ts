import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter, SessionSummary } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { buildTrajectory } from '../local/common'
import {
  fetchTexts,
  parseJsonl,
  toolPart,
  toolTitleFromInput,
  truncatedOutput,
  truncatedReasoning,
  truncatedText,
  titleFromPrompt,
  type NodeDraft,
} from '../local/common'

const SESSION_FILE = /\/sessions\/[^/]+\/\d{4}-\d{2}-\d{2}T[\d-]+Z_[0-9a-f-]+\.jsonl$/

interface PiLine {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    timestamp?: number
    model?: string
    stopReason?: string
    toolCallId?: string
    isError?: boolean
  }
}

function readPiLines(text: string): PiLine[] {
  return parseJsonl<PiLine>(text).filter((l) => l.type && l.timestamp)
}

function userTextOf(message: NonNullable<PiLine['message']>): string {
  if (!Array.isArray(message.content)) return ''
  for (const item of message.content) {
    if (item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text') {
      const t = (item as Record<string, unknown>).text
      if (typeof t === 'string' && t.trim()) return t
    }
  }
  return ''
}

function userParts(message: NonNullable<PiLine['message']>): Part[] {
  const parts: Part[] = []
  if (!Array.isArray(message.content)) return parts
  for (const item of message.content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim())
      parts.push(truncatedText(record.text))
    else if (record.type === 'image' && typeof record.data === 'string')
      parts.push({
        kind: 'attachment',
        files: [
          { fileId: `img-${record.data.length}`, fileName: 'image', fileSize: record.data.length },
        ],
      })
  }
  return parts
}

function assistantParts(
  message: NonNullable<PiLine['message']>,
  pendingResults: Map<string, ToolCallPayload>,
): Part[] {
  const parts: Part[] = []
  if (!Array.isArray(message.content)) return parts
  for (const item of message.content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'thinking' && typeof record.thinking === 'string' && record.thinking)
      parts.push(truncatedReasoning(record.thinking))
    else if (record.type === 'text' && typeof record.text === 'string' && record.text.trim())
      parts.push(truncatedText(record.text))
    else if (record.type === 'toolCall') {
      const payload: ToolCallPayload = {
        title: toolTitleFromInput(record.arguments),
        input: record.arguments,
      }
      const callId = typeof record.id === 'string' ? record.id : ''
      if (callId) pendingResults.set(callId, payload)
      parts.push(toolPart(String(record.name ?? 'tool'), payload))
    }
  }
  return parts
}

function collectToolResult(content: unknown, outputs: string[], images: Part[]): void {
  if (typeof content === 'string') {
    outputs.push(content)
    return
  }
  if (!Array.isArray(content)) return
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') outputs.push(record.text)
    else if (record.type === 'image' && typeof record.data === 'string')
      images.push({
        kind: 'attachment',
        files: [
          { fileId: `img-${record.data.length}`, fileName: 'image', fileSize: record.data.length },
        ],
      })
  }
}

/** Shared body builder for one session's lines */
function buildBody(lines: readonly PiLine[], rawId: string): NodeDraft[] {
  const drafts: NodeDraft[] = []
  let lastAssistant: NodeDraft | null = null
  const pendingResults = new Map<string, ToolCallPayload>()
  let previousRole: string | null = null

  for (const line of lines) {
    if (line.type !== 'message' || !line.message) continue
    const message = line.message
    const at = message.timestamp ?? 0

    if (message.role === 'user') {
      drafts.push({ id: `${rawId}:u${drafts.length}`, at, role: 'user', parts: userParts(message) })
      lastAssistant = null
      previousRole = 'user'
    } else if (message.role === 'assistant') {
      if (message.stopReason === 'error') continue
      const parts = assistantParts(message, pendingResults)
      if (!parts.length) continue
      const draft: NodeDraft = {
        id: `${rawId}:a${drafts.length}`,
        at,
        role: 'assistant',
        model: message.model ?? null,
        parts,
      }
      drafts.push(draft)
      lastAssistant = draft
      previousRole = 'assistant'
    } else if (message.role === 'toolResult') {
      const callId = message.toolCallId
      const pending = typeof callId === 'string' ? pendingResults.get(callId) : undefined
      if (pending) {
        const outputs: string[] = []
        const images: Part[] = []
        collectToolResult(message.content, outputs, images)
        if (outputs.length) Object.assign(pending, truncatedOutput(outputs.join('\n')))
        if (message.isError === true) pending.error = pending.error ?? 'error'
        if (lastAssistant) for (const image of images) lastAssistant.parts.push(image)
      }
    }
  }
  void previousRole
  return drafts
}

/** Light summaries: user-turn boundaries and first prompts only */
function summarizeLines(lines: readonly PiLine[], rawId: string): SessionSummary | null {
  let firstPrompt = ''
  let startedAt = Number.POSITIVE_INFINITY
  let updatedAt = 0
  let previousRole: string | null = null
  const turnStarts: number[] = []
  let messageCount = 0

  for (const line of lines) {
    if (line.type !== 'message' || !line.message) continue
    const message = line.message
    const at = message.timestamp ?? 0
    startedAt = Math.min(startedAt, at)
    updatedAt = Math.max(updatedAt, at)

    if (message.role === 'user') {
      const text = userTextOf(message)
      if (!text) continue
      messageCount++
      if (previousRole !== 'user') turnStarts.push(at)
      previousRole = 'user'
      if (!firstPrompt) firstPrompt = text
    } else if (message.role === 'assistant') {
      if (message.stopReason === 'error') continue
      messageCount++
      previousRole = 'assistant'
    } else {
      continue // system / toolResult don't count as dialogue messages
    }
  }

  if (!turnStarts.length) return null
  return {
    id: `pi:${rawId}`,
    sessionId: rawId,
    title: titleFromPrompt(firstPrompt) || '(untitled)',
    startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
    updatedAt,
    turnStarts,
    messageCount,
    firstPrompt,
  }
}

export const piAdapter: SourceAdapter = {
  id: 'pi',
  label: 'Pi',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => SESSION_FILE.test(`/${f.path}`))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'pi', 'Pi')
    const sessionFiles = manifest.files
      .filter((f) => SESSION_FILE.test(`/${f.path}`))
      .map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    const summaries: SessionSummary[] = []
    for (const [filePath, text] of texts) {
      const lines = readPiLines(text)
      const rawId = filePath.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] ?? filePath
      const summary = summarizeLines(lines, rawId)
      if (summary) summaries.push(summary)
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
    const identity = sourceIdentity(manifest, 'pi', 'Pi')
    const file = manifest.files.find((f) => f.path.split('/').pop()?.includes(sessionId))
    if (!file) return null
    const lines = readPiLines(new TextDecoder().decode(await fetchFile(file.path)))
    const drafts = buildBody(lines, sessionId)
    if (!drafts.length) return null

    let startedAt = Number.POSITIVE_INFINITY
    let updatedAt = 0
    for (const line of lines) {
      if (!line.timestamp) continue
      const at = Date.parse(line.timestamp)
      if (Number.isNaN(at)) continue
      startedAt = Math.min(startedAt, at)
      updatedAt = Math.max(updatedAt, at)
    }
    let firstPrompt = ''
    for (const draft of drafts) {
      if (draft.role !== 'user') continue
      const text = draft.parts.find((p) => p.kind === 'text')
      if (text && text.kind === 'text') {
        firstPrompt = text.text
        break
      }
    }

    return buildTrajectory({
      identity,
      rawId: sessionId,
      title: titleFromPrompt(firstPrompt) || '(untitled)',
      startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
      updatedAt,
      drafts,
    })
  },

  piiHints: ['session.cwd'],
}
