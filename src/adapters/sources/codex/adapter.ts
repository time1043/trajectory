import type { ToolCallPayload } from '@/domain/model/part'
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

const SESSION_FILE = /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]+\.jsonl$/

interface CodexLine {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

function contentText(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const out: string[] = []
  for (const item of content) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.text === 'string' && record.text) out.push(record.text)
    }
  }
  return out
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function buildDrafts(
  lines: readonly CodexLine[],
  rawId: string,
  model: string | null,
): NodeDraft[] {
  const drafts: NodeDraft[] = []
  let lastAssistant: NodeDraft | null = null
  const pendingOutputs = new Map<string, ToolCallPayload>()
  let currentModel = model

  for (const line of lines) {
    if (!line.timestamp || !line.type) continue
    const at = Date.parse(line.timestamp)
    if (Number.isNaN(at)) continue

    if (line.type === 'turn_context') {
      const m = line.payload?.model
      if (typeof m === 'string') currentModel = m
      continue
    }
    if (line.type !== 'response_item') continue

    const payload = line.payload ?? {}
    const kind = payload.type

    if (kind === 'message') {
      const role = payload.role
      const text = contentText(payload.content)
      if (role === 'user') {
        const real = text.filter(
          (t) =>
            !/^<(environment_context|user_instructions|permissions)/.test(t.trim()) &&
            !/^# AGENTS\.md/.test(t.trim()),
        )
        if (!real.length) continue
        drafts.push({
          id: `${rawId}:u${drafts.length}`,
          at,
          role: 'user',
          parts: [truncatedText(real.join('\n\n'))],
        })
        lastAssistant = null
      } else if (role === 'assistant') {
        if (!text.join('').trim()) continue
        const draft: NodeDraft = {
          id: `${rawId}:a${drafts.length}`,
          at,
          role: 'assistant',
          model: currentModel,
          parts: text.map((t) => truncatedText(t)),
        }
        drafts.push(draft)
        lastAssistant = draft
      }
      continue
    }

    if (kind === 'reasoning') {
      const summary = contentText(payload.summary).join('\n\n')
      if (!summary) continue // encrypted-only reasoning has no readable content
      if (!lastAssistant) {
        lastAssistant = {
          id: `${rawId}:a${drafts.length}`,
          at,
          role: 'assistant',
          model: currentModel,
          parts: [],
        }
        drafts.push(lastAssistant)
      }
      lastAssistant.parts.push(truncatedReasoning(summary))
      continue
    }

    if (kind === 'function_call' || kind === 'custom_tool_call') {
      const tool = String(payload.name ?? 'tool')
      const input = parseMaybeJson(payload.arguments ?? payload.input)
      const callPayload: ToolCallPayload = {
        title:
          toolTitleFromInput(input) ??
          (typeof input === 'string' ? input.slice(0, 200) : undefined),
        input,
      }
      pendingOutputs.set(String(payload.call_id ?? ''), callPayload)
      if (!lastAssistant) {
        lastAssistant = {
          id: `${rawId}:a${drafts.length}`,
          at,
          role: 'assistant',
          model: currentModel,
          parts: [],
        }
        drafts.push(lastAssistant)
      }
      lastAssistant.parts.push(toolPart(tool, callPayload))
      continue
    }

    if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
      const pending = pendingOutputs.get(String(payload.call_id ?? ''))
      if (pending) {
        const raw =
          typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '')
        Object.assign(pending, truncatedOutput(raw))
      }
      continue
    }

    if (kind === 'web_search_call') {
      const action = (payload.action ?? {}) as Record<string, unknown>
      const query = typeof action.query === 'string' ? action.query : undefined
      if (!lastAssistant) {
        lastAssistant = {
          id: `${rawId}:a${drafts.length}`,
          at,
          role: 'assistant',
          model: currentModel,
          parts: [],
        }
        drafts.push(lastAssistant)
      }
      lastAssistant.parts.push(toolPart('web_search', { title: query, input: action }))
      continue
    }

    if (kind === 'compacted') {
      const message = typeof payload.message === 'string' ? payload.message : ''
      if (message) {
        drafts.push({
          id: `${rawId}:c${drafts.length}`,
          at,
          role: 'assistant',
          model: currentModel,
          parts: [truncatedText(`[compacted]\n${message}`)],
        })
      }
      continue
    }
  }
  return drafts
}

/** Light summaries: user-turn boundaries and prompts from the same stream */
function summarize(lines: readonly CodexLine[], rawId: string): SessionSummary | null {
  let firstPrompt = ''
  let startedAt = Number.POSITIVE_INFINITY
  let updatedAt = 0
  let previousRole: string | null = null
  const turnStarts: number[] = []
  let messageCount = 0

  for (const line of lines) {
    if (!line.timestamp || !line.type) continue
    const at = Date.parse(line.timestamp)
    if (Number.isNaN(at)) continue
    startedAt = Math.min(startedAt, at)
    updatedAt = Math.max(updatedAt, at)
    if (line.type !== 'response_item') continue

    const payload = line.payload ?? {}
    if (payload.type !== 'message') continue
    const role = payload.role
    if (role !== 'user' && role !== 'assistant') continue // developer role: dropped

    const text = contentText(payload.content)
    if (role === 'user') {
      const real = text.filter(
        (t) =>
          !/^<(environment_context|user_instructions|permissions)/.test(t.trim()) &&
          !/^# AGENTS\.md/.test(t.trim()),
      )
      if (!real.length) continue
      messageCount++
      if (previousRole !== 'user') turnStarts.push(at)
      previousRole = 'user'
      if (!firstPrompt) firstPrompt = real.join('\n\n')
    } else {
      if (!text.join('').trim()) continue
      messageCount++
      previousRole = 'assistant'
    }
  }

  if (!turnStarts.length) return null
  const started = startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt
  return {
    id: `codex:${rawId}`,
    sessionId: rawId,
    title: titleFromPrompt(firstPrompt) || '(untitled)',
    startedAt: started,
    updatedAt,
    turnStarts,
    messageCount,
    firstPrompt,
  }
}

export const codexAdapter: SourceAdapter = {
  id: 'codex',
  label: 'Codex',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => SESSION_FILE.test(`/${f.path}`))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'codex', 'Codex')
    const sessionFiles = manifest.files
      .filter((f) => SESSION_FILE.test(`/${f.path}`))
      .map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    const summaries: SessionSummary[] = []
    for (const [filePath, text] of texts) {
      const lines = parseJsonl<CodexLine>(text)
      const rawId = filePath.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] ?? filePath
      const summary = summarize(lines, rawId)
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
    const identity = sourceIdentity(manifest, 'codex', 'Codex')
    const file = manifest.files.find((f) => f.path.split('/').pop()?.includes(sessionId))
    if (!file) return null
    const lines = parseJsonl<CodexLine>(new TextDecoder().decode(await fetchFile(file.path)))
    const drafts = buildDrafts(lines, sessionId, null)

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
    for (const line of lines) {
      if (
        line.type === 'response_item' &&
        line.payload?.type === 'message' &&
        line.payload?.role === 'user'
      ) {
        const real = contentText(line.payload.content).filter(
          (t) =>
            !/^<(environment_context|user_instructions|permissions)/.test(t.trim()) &&
            !/^# AGENTS\.md/.test(t.trim()),
        )
        if (real.length) {
          firstPrompt = real.join('\n\n')
          break
        }
      }
    }

    if (!drafts.length) return null
    return buildTrajectory({
      identity,
      rawId: sessionId,
      title: titleFromPrompt(firstPrompt) || '(untitled)',
      startedAt: startedAt === Number.POSITIVE_INFINITY ? updatedAt : startedAt,
      updatedAt,
      drafts,
    })
  },

  piiHints: ['session_meta.payload.cwd', 'session_meta.payload.git'],
}
