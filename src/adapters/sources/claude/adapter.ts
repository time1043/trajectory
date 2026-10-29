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
  truncatedReasoning,
  truncatedText,
  titleFromPrompt,
  type NodeDraft,
} from '../local/common'

// only session files directly under projects/<slug>/ — the sibling <uuid>/
// directories hold tool-result overflow files and subagent sessions
const SESSION_FILE =
  /\/projects\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/

interface ClaudeLine {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    model?: string
    content?: unknown
  }
  aiTitle?: string
}

/** Context injections that wrap machine-generated text inside user turns */
const WRAPPED_PREFIX =
  /^<(ide_opened_file|ide_selection|system-reminder|task-notification|command-name|local-command|user-prompt-submit-hook|bash-input|bash-stdout)\b/

function readClaudeLines(text: string): ClaudeLine[] {
  return parseJsonl<ClaudeLine>(text).filter((l) => l.type && l.timestamp)
}

function userParts(content: unknown, pendingResults: Map<string, ToolCallPayload>): Part[] {
  const parts: Part[] = []
  if (typeof content === 'string') {
    if (content.trim() && !WRAPPED_PREFIX.test(content.trim())) parts.push(truncatedText(content))
    return parts
  }
  if (!Array.isArray(content)) return parts
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'text') {
      const text = typeof record.text === 'string' ? record.text : ''
      if (text.trim() && !WRAPPED_PREFIX.test(text.trim())) parts.push(truncatedText(text))
    } else if (record.type === 'tool_result') {
      const pending =
        typeof record.tool_use_id === 'string' ? pendingResults.get(record.tool_use_id) : undefined
      if (pending) {
        const raw =
          typeof record.content === 'string' ? record.content : JSON.stringify(record.content ?? '')
        Object.assign(pending, truncatedOutput(raw))
        if (record.is_error === true) pending.error = pending.error ?? 'error'
      }
    } else if (record.type === 'image') {
      const source = (record.source ?? {}) as Record<string, unknown>
      const size = typeof source.data === 'string' ? source.data.length : 0
      parts.push({
        kind: 'attachment',
        files: [
          { fileId: `img-${size}`, fileName: String(source.media_type ?? 'image'), fileSize: size },
        ],
      })
    }
  }
  return parts
}

function assistantParts(
  message: ClaudeLine['message'],
  pendingResults: Map<string, ToolCallPayload>,
): Part[] {
  const parts: Part[] = []
  if (!message || !Array.isArray(message.content)) return parts
  for (const item of message.content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'thinking' && typeof record.thinking === 'string' && record.thinking)
      parts.push(truncatedReasoning(record.thinking))
    else if (record.type === 'text' && typeof record.text === 'string' && record.text.trim())
      parts.push(truncatedText(record.text))
    else if (record.type === 'tool_use') {
      const payload: ToolCallPayload = {
        title: toolTitleFromInput(record.input),
        input: record.input,
      }
      const callId = typeof record.id === 'string' ? record.id : ''
      if (callId) pendingResults.set(callId, payload)
      parts.push(toolPart(String(record.name ?? 'tool'), payload))
    }
  }
  return parts
}

/** First real user prompt (context injections excluded) — for summaries */
function firstPromptOf(lines: readonly ClaudeLine[]): string {
  for (const line of lines) {
    if (line.type !== 'user' || !line.message) continue
    const parts = userParts(line.message.content, new Map())
    const text = parts.find((p) => p.kind === 'text')
    if (text && text.kind === 'text') return text.text
  }
  return ''
}

function buildSummariesFromLines(
  lines: readonly ClaudeLine[],
  rawId: string,
  identity: ReturnType<typeof sourceIdentity>,
  messageCount: number,
): SessionSummary[] {
  let title = ''
  let firstPrompt = ''
  let startedAt = Number.POSITIVE_INFINITY
  let updatedAt = 0
  let previousRole: string | null = null
  const turnStarts: number[] = []

  for (const line of lines) {
    if (!line.timestamp) continue
    const at = Date.parse(line.timestamp)
    if (Number.isNaN(at)) continue
    startedAt = Math.min(startedAt, at)
    updatedAt = Math.max(updatedAt, at)

    if (line.type === 'ai-title') {
      if (!title && typeof line.aiTitle === 'string') title = line.aiTitle
      continue
    }
    if (line.type !== 'user' && line.type !== 'assistant') continue
    const role = line.type
    if (role === 'user') {
      const prompt = firstPromptOf([line])
      if (!firstPrompt && prompt) firstPrompt = prompt
      if (previousRole !== 'user') turnStarts.push(at)
      previousRole = 'user'
    } else {
      previousRole = 'assistant'
    }
  }

  if (!turnStarts.length) return []
  const finalTitle = title || titleFromPrompt(firstPrompt) || ''
  return [
    {
      id: `${identity.sourceId}:${rawId}`,
      sessionId: rawId,
      title: finalTitle,
      startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
      updatedAt,
      turnStarts,
      messageCount,
      firstPrompt,
    },
  ]
}

/** Full pass: build the body drafts for one session's lines */
function buildDrafts(lines: readonly ClaudeLine[], rawId: string): NodeDraft[] {
  const drafts: NodeDraft[] = []
  let startedAt = Number.POSITIVE_INFINITY
  const pendingResults = new Map<string, ToolCallPayload>()

  for (const line of lines) {
    if (!line.type || !line.timestamp) continue
    const at = Date.parse(line.timestamp)
    if (Number.isNaN(at)) continue
    startedAt = Math.min(startedAt, at)

    if (line.type === 'ai-title') continue

    if (line.type !== 'user' && line.type !== 'assistant') continue
    const message = line.message
    if (!message || message.model === '<synthetic>') continue

    if (line.type === 'user') {
      const parts = userParts(message.content, pendingResults)
      if (!parts.length) continue // pure tool-result lines merge into their tool call
      const textParts = parts.filter((p): p is Extract<Part, { kind: 'text' }> => p.kind === 'text')
      const joined = textParts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n\n')
      drafts.push({
        id: `${rawId}:u${drafts.length}`,
        at,
        role: 'user',
        parts: [
          ...(joined ? [truncatedText(joined)] : []),
          ...parts.filter((p) => p.kind !== 'text'),
        ],
      })
      continue
    }

    const parts = assistantParts(message, pendingResults)
    if (!parts.length) continue
    drafts.push({
      id: `${rawId}:a${drafts.length}`,
      at,
      role: 'assistant',
      model: message.model ?? null,
      parts,
    })
  }
  void startedAt
  return drafts
}

export const claudeAdapter: SourceAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => SESSION_FILE.test(`/${f.path}`))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'claude-code', 'Claude Code')
    const sessionFiles = manifest.files
      .filter((f) => SESSION_FILE.test(`/${f.path}`))
      .map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    const summaries: SessionSummary[] = []
    for (const [filePath, text] of texts) {
      const lines = readClaudeLines(text)
      const rawId =
        filePath.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
        )?.[1] ?? filePath
      const visibleLines = lines.filter((l) => l.type === 'user' || l.type === 'assistant').length
      summaries.push(...buildSummariesFromLines(lines, rawId, identity, visibleLines))
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
    const identity = sourceIdentity(manifest, 'claude-code', 'Claude Code')
    const manifest_file = manifest.files.find((f) => f.path.endsWith(`${sessionId}.jsonl`))
    if (!manifest_file) return null
    const text = new TextDecoder().decode(await fetchFile(manifest_file.path))
    const lines = readClaudeLines(text)
    const drafts = buildDrafts(lines, sessionId)
    if (!drafts.length) return null

    const times = lines
      .filter((l) => l.timestamp)
      .map((l) => Date.parse(l.timestamp!))
      .filter((t) => !Number.isNaN(t))
    let title = ''
    for (const line of lines) {
      if (line.type === 'ai-title' && typeof line.aiTitle === 'string') {
        title = line.aiTitle
        break
      }
    }
    if (!title) {
      for (const draft of drafts) {
        if (draft.role !== 'user') continue
        const text = draft.parts.find((p) => p.kind === 'text')
        if (text && text.kind === 'text') {
          title = titleFromPrompt(text.text)
          break
        }
      }
    }

    return buildTrajectory({
      identity,
      rawId: sessionId,
      title: title || '(untitled)',
      startedAt: times.length ? Math.min(...times) : 0,
      updatedAt: times.length ? Math.max(...times) : 0,
      drafts,
    })
  },

  piiHints: ['line.cwd'],
}
