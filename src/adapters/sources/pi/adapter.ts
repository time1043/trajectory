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

const SESSION_FILE = /\/sessions\/[^/]+\/\d{4}-\d{2}-\d{2}T[\d-]+Z_[0-9a-f-]+\.jsonl$/

interface PiLine {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    content?: unknown
    timestamp?: number
    model?: string
    provider?: string
    stopReason?: string
    toolCallId?: string
    toolName?: string
    isError?: boolean
  }
}

/**
 * Pi agent sessions: one JSONL per session under a project-slug directory
 * (`--escaped-cwd--`; the first line's session.cwd is authoritative). Roles
 * are user / assistant / toolResult / system — tool results are separate
 * messages that merge back into the tool call that produced them.
 */
export const piAdapter: SourceAdapter = {
  id: 'pi',
  label: 'Pi',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => SESSION_FILE.test(`/${f.path}`))
  },
  async parse({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'pi', 'Pi')
    const build: SourceBuild = { trajectories: [], unknownPartCounts: {} }
    const sessionFiles = manifest.files
      .filter((f) => SESSION_FILE.test(`/${f.path}`))
      .map((f) => f.path)
    const texts = await fetchTexts(sessionFiles, fetchFile)

    for (const [filePath, text] of texts) {
      const lines = parseJsonl<PiLine>(text)
      const rawId = uuidFromPath(filePath)
      const drafts: NodeDraft[] = []
      let firstPrompt = ''
      let startedAt = Number.POSITIVE_INFINITY
      let updatedAt = 0
      let lastAssistant: NodeDraft | null = null
      const pendingResults = new Map<string, ToolCallPayload>()

      for (const line of lines) {
        if (!line.type || !line.timestamp) continue
        const lineAt = Date.parse(line.timestamp)
        if (!Number.isNaN(lineAt)) {
          startedAt = Math.min(startedAt, lineAt)
          updatedAt = Math.max(updatedAt, lineAt)
        }

        if (line.type !== 'message' || !line.message) continue // session header, model_change, context_edit: metadata only

        const message = line.message
        const role = message.role
        const at = message.timestamp ?? lineAt

        if (role === 'user') {
          const parts = contentParts(message.content)
          const textsOnly = parts.filter((p) => p.kind === 'text')
          if (!textsOnly.length) continue
          const joined = textsOnly.map((p) => (p.kind === 'text' ? p.text : '')).join('\n\n')
          if (!firstPrompt) firstPrompt = joined
          drafts.push({
            id: `${rawId}:u${drafts.length}`,
            at,
            role: 'user',
            parts: [truncatedText(joined)],
          })
          lastAssistant = null
          continue
        }

        if (role === 'assistant') {
          if (message.stopReason === 'error') continue // failed turns carry no readable content
          const parts = contentParts(message.content, pendingResults)
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
          continue
        }

        if (role === 'toolResult') {
          // merge into the tool call that produced it
          const callId = message.toolCallId
          const pending = typeof callId === 'string' ? pendingResults.get(callId) : undefined
          if (pending) {
            const outputs: string[] = []
            const images: Part[] = []
            collectToolResult(message.content, outputs, images)
            if (outputs.length) Object.assign(pending, truncatedOutput(outputs.join('\n')))
            const target = lastAssistant
            if (target) {
              for (const image of images) target.parts.push(image)
            }
            if (message.isError === true) pending.error = pending.error ?? 'error'
          }
          continue
        }

        // system prompts: long boilerplate, not dialogue
      }

      const trajectory = finishSession({
        identity,
        rawId,
        drafts,
        startedAt,
        updatedAt,
        firstPrompt,
      })
      if (trajectory) build.trajectories.push(trajectory)
    }

    return {
      sourceId: identity.sourceId,
      provider: identity.provider,
      providerLabel: identity.providerLabel,
      user: identity.user,
      profile: null,
      trajectories: build.trajectories,
      diagnostics: { unknownPartCounts: build.unknownPartCounts, invariantViolations: [] },
    }
  },
  piiHints: ['session.cwd'],
}

function contentParts(content: unknown, pendingResults?: Map<string, ToolCallPayload>): Part[] {
  const parts: Part[] = []
  if (!Array.isArray(content)) return parts
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    switch (record.type) {
      case 'text': {
        const text = typeof record.text === 'string' ? record.text : ''
        if (text.trim()) parts.push(truncatedText(text))
        break
      }
      case 'thinking': {
        const text = typeof record.thinking === 'string' ? record.thinking : ''
        if (text) parts.push(truncatedReasoning(text))
        break
      }
      case 'toolCall': {
        const payload: ToolCallPayload = {
          title: toolTitleFromInput(record.arguments),
          input: record.arguments,
        }
        const callId = typeof record.id === 'string' ? record.id : ''
        if (pendingResults && callId) pendingResults.set(callId, payload)
        parts.push(toolPart(String(record.name ?? 'tool'), payload))
        break
      }
      case 'image': {
        const size = typeof record.data === 'string' ? record.data.length : 0
        parts.push({
          kind: 'attachment',
          files: [{ fileId: `img-${size}`, fileName: 'image', fileSize: size }],
        })
        break
      }
      default:
        break
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
