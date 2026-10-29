import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import {
  fetchTexts,
  parseJsonl,
  toolPart,
  toolTitleFromInput,
  truncatedOutput,
  truncatedReasoning,
  truncatedText,
  type NodeDraft,
  type SourceBuild,
  finishSession,
  uuidFromPath,
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

/**
 * Claude Code sessions: one JSONL per session under projects/<slug>/. The line
 * type zoo is handled by a strict whitelist — api-request snapshots,
 * file-history, queue-operations etc. duplicate the dialogue and are dropped.
 * Tool results arrive in user-role lines and merge back into their tool_use.
 */
export const claudeAdapter: SourceAdapter = {
  id: 'claude',
  label: 'Claude Code',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => SESSION_FILE.test(`/${f.path}`))
  },
  async parse({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'claude-code', 'Claude Code')
    const build: SourceBuild = { trajectories: [], unknownPartCounts: {} }
    const sessionFiles = manifest.files
      .filter((f) => SESSION_FILE.test(`/${f.path}`))
      .map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    for (const [filePath, text] of texts) {
      const lines = parseJsonl<ClaudeLine>(text)
      const rawId = uuidFromPath(filePath)
      const drafts: NodeDraft[] = []
      let aiTitle = ''
      let firstPrompt = ''
      let startedAt = Number.POSITIVE_INFINITY
      let updatedAt = 0
      const pendingResults = new Map<string, ToolCallPayload>()

      for (const line of lines) {
        if (!line.type || !line.timestamp) continue
        const at = Date.parse(line.timestamp)
        if (!Number.isNaN(at)) {
          startedAt = Math.min(startedAt, at)
          updatedAt = Math.max(updatedAt, at)
        }

        if (line.type === 'ai-title') {
          if (!aiTitle && typeof line.aiTitle === 'string') aiTitle = line.aiTitle
          continue
        }

        if (line.type !== 'user' && line.type !== 'assistant') continue // attachments, api-request snapshots, cost-state, modes: dropped by whitelist

        const message = line.message
        if (!message || message.model === '<synthetic>') continue

        if (line.type === 'user') {
          const parts = userParts(message.content, pendingResults)
          if (!parts.length) continue // pure tool-result lines merge into their tool call
          const textParts = parts.filter((p) => p.kind === 'text')
          const joined = textParts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n\n')
          if (!firstPrompt && joined) firstPrompt = joined
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

        // assistant
        const parts: Part[] = []
        if (Array.isArray(message.content)) {
          for (const item of message.content) {
            if (!item || typeof item !== 'object') continue
            const record = item as Record<string, unknown>
            if (
              record.type === 'thinking' &&
              typeof record.thinking === 'string' &&
              record.thinking
            )
              parts.push(truncatedReasoning(record.thinking))
            else if (
              record.type === 'text' &&
              typeof record.text === 'string' &&
              record.text.trim()
            )
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
        }
        if (!parts.length) continue
        drafts.push({
          id: `${rawId}:a${drafts.length}`,
          at,
          role: 'assistant',
          model: message.model ?? null,
          parts,
        })
      }

      const trajectory = finishSession({
        sourceId: 'claude',
        rawId,
        drafts,
        startedAt,
        updatedAt,
        title: aiTitle,
        firstPrompt,
      })
      if (trajectory) build.trajectories.push(trajectory)
    }

    return {
      sourceId: 'claude',
      label: identity.label,
      profile: null,
      trajectories: build.trajectories,
      diagnostics: { unknownPartCounts: build.unknownPartCounts, invariantViolations: [] },
    }
  },
  piiHints: ['line.cwd'],
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
