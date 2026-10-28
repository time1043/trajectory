import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'
import type { ToolCallPayload } from '@/domain/model/part'
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

const SESSION_FILE = /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^/]+\.jsonl$/

interface CodexLine {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

/**
 * Codex CLI sessions: one rollout-*.jsonl per session under sessions/YYYY/MM/DD/.
 * response_item lines carry the dialogue; event_msg/world_state/token_usage
 * duplicate or annotate it and are dropped wholesale. Reasoning only exists as
 * summaries (the content is encrypted). arguments/output are nested JSON
 * strings and fall back to raw text when they fail to parse.
 */
export const codexAdapter: SourceAdapter = {
  id: 'codex',
  label: 'Codex',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some(f => SESSION_FILE.test(`/${f.path}`))
  },
  async parse({ manifest, fetchFile }) {
    const build: SourceBuild = { trajectories: [], unknownPartCounts: {} }
    const sessionFiles = manifest.files.filter(f => SESSION_FILE.test(`/${f.path}`)).map(f => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    for (const [filePath, text] of texts) {
      const lines = parseJsonl<CodexLine>(text)
      const rawId = uuidFromPath(filePath)
      const drafts: NodeDraft[] = []
      let firstPrompt = ''
      let model: string | null = null
      let startedAt = Number.POSITIVE_INFINITY
      let updatedAt = 0
      let lastAssistant: NodeDraft | null = null
      const pendingOutputs = new Map<string, ToolCallPayload>()

      const ensureAssistant = (at: number): NodeDraft => {
        if (!lastAssistant) {
          lastAssistant = { id: `${rawId}:a${drafts.length}`, at, role: 'assistant', model, parts: [] }
          drafts.push(lastAssistant)
        }
        return lastAssistant
      }

      for (const line of lines) {
        if (!line.timestamp || !line.type)
          continue
        const at = Date.parse(line.timestamp)
        if (!Number.isNaN(at)) {
          startedAt = Math.min(startedAt, at)
          updatedAt = Math.max(updatedAt, at)
        }

        if (line.type === 'session_meta') {
          // cwd/git metadata is not surfaced in v1
          continue
        }
        if (line.type === 'turn_context') {
          const m = line.payload?.model
          if (typeof m === 'string')
            model = m
          continue
        }
        if (line.type !== 'response_item')
          continue

        const payload = line.payload ?? {}
        const kind = payload.type

        if (kind === 'message') {
          const role = payload.role
          const text = contentText(payload.content)
          if (role === 'user') {
            // the turn boundary resets regardless of filtering: a dropped
            // environment wrapper still starts a new user turn
            lastAssistant = null
            // environment/instruction wrappers and project instruction dumps are injections, not the user's voice
            const real = text.filter(t => !/^<(environment_context|user_instructions|permissions)/.test(t.trim()) && !/^# AGENTS\.md/.test(t.trim()))
            if (!real.length)
              continue
            const joined = real.join('\n\n')
            if (!firstPrompt)
              firstPrompt = joined
            drafts.push({ id: `${rawId}:u${drafts.length}`, at, role: 'user', parts: [truncatedText(joined)] })
          }
          else if (role === 'assistant') {
            if (!text.join('').trim())
              continue
            const draft: NodeDraft = { id: `${rawId}:a${drafts.length}`, at, role: 'assistant', model, parts: text.map(t => truncatedText(t)) }
            drafts.push(draft)
            lastAssistant = draft
          }
          // developer role: permission boilerplate, dropped
          continue
        }

        if (kind === 'reasoning') {
          const summary = contentText(payload.summary).join('\n\n')
          if (!summary)
            continue // encrypted-only reasoning has no readable content
          const draft = ensureAssistant(at)
          draft.parts.push(truncatedReasoning(summary))
          continue
        }

        if (kind === 'function_call' || kind === 'custom_tool_call') {
          const tool = String(payload.name ?? 'tool')
          const input = parseMaybeJson(payload.arguments ?? payload.input)
          const callPayload: ToolCallPayload = {
            title: toolTitleFromInput(input) ?? (typeof input === 'string' ? truncateLine(input) : undefined),
            input,
          }
          pendingOutputs.set(String(payload.call_id ?? ''), callPayload)
          const draft = ensureAssistant(at)
          draft.parts.push(toolPart(tool, callPayload))
          continue
        }

        if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
          const pending = pendingOutputs.get(String(payload.call_id ?? ''))
          if (pending) {
            const raw = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '')
            Object.assign(pending, truncatedOutput(raw))
          }
          continue
        }

        if (kind === 'web_search_call') {
          const action = (payload.action ?? {}) as Record<string, unknown>
          const query = typeof action.query === 'string' ? action.query : undefined
          const draft = ensureAssistant(at)
          draft.parts.push(toolPart('web_search', { title: query, input: action }))
          continue
        }

        if (kind === 'compacted') {
          const message = typeof payload.message === 'string' ? payload.message : ''
          if (message)
            drafts.push({ id: `${rawId}:c${drafts.length}`, at, role: 'assistant', model, parts: [truncatedText(`[compacted]\n${message}`)] })
          continue
        }

        build.unknownPartCounts[String(kind)] = (build.unknownPartCounts[String(kind)] ?? 0) + 1
      }

      const trajectory = finishSession({ sourceId: 'codex', rawId, drafts, startedAt, updatedAt, firstPrompt })
      if (trajectory)
        build.trajectories.push(trajectory)
    }

    return {
      sourceId: 'codex',
      label: 'Codex',
      profile: null,
      trajectories: build.trajectories,
      diagnostics: { unknownPartCounts: build.unknownPartCounts, invariantViolations: [] },
    }
  },
  piiHints: ['session_meta.payload.cwd', 'session_meta.payload.git'],
}

function contentText(content: unknown): string[] {
  if (!Array.isArray(content))
    return []
  const out: string[] = []
  for (const item of content) {
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.text === 'string' && record.text)
        out.push(record.text)
    }
  }
  return out
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}

function truncateLine(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > 60 ? `${single.slice(0, 60)}…` : single
}
