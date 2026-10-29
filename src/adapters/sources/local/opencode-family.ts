import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { ParsedSource, Trajectory } from '@/domain/model/trajectory'
import type { QuerySqlite } from '@/domain/ports/data-host'
import type { SourceIdentity } from '@/domain/ports/source-adapter'

import {
  buildTrajectory,
  toolPart,
  toolTitleFromInput,
  truncatedOutput,
  truncatedReasoning,
  titleFromPrompt,
  type NodeDraft,
  type SourceBuild,
} from './common'

/**
 * Shared parser for the opencode-family schema (session/message/part tables
 * with JSON `data` columns) — zcode is a superset of opencode. Differences
 * live in the dialect: ordering columns, noise filtering via `semantics`,
 * extra part kinds, and title fallbacks.
 */
export interface OpencodeFamilyDialect {
  sessionsSql: string
  messagesSql: string
  partsSql: string
  /** Return true to drop a whole message envelope */
  skipMessage(data: Record<string, unknown>): boolean
  /** Dialect-specific part kinds; return null to skip */
  extraPart(data: Record<string, unknown>, unknownCounts: Record<string, number>): Part | null
  /** Post-process the stored title (fallbacks run after this) */
  normalizeTitle?(title: string): string
  filterSession?(row: Record<string, unknown>): boolean
}

export async function parseOpencodeFamily(opts: {
  querySqlite: QuerySqlite
  identity: SourceIdentity
  dbPath: string
  dialect: OpencodeFamilyDialect
}): Promise<ParsedSource> {
  const { querySqlite, dialect, identity } = opts
  const build: SourceBuild = { trajectories: [], unknownPartCounts: {} }

  const sessions = (await querySqlite(opts.dbPath, dialect.sessionsSql)).rows
  for (const session of sessions) {
    if (dialect.filterSession?.(session)) continue
    const sessionId = String(session.id)
    const drafts: NodeDraft[] = []
    let firstPrompt = ''

    const [messages, parts] = await Promise.all([
      querySqlite(opts.dbPath, dialect.messagesSql, [sessionId]),
      querySqlite(opts.dbPath, dialect.partsSql, [sessionId]),
    ])

    const partsByMessage = new Map<string, Record<string, unknown>[]>()
    for (const row of parts.rows) {
      const key = String(row.message_id)
      const list = partsByMessage.get(key) ?? []
      list.push(JSON.parse(String(row.data)) as Record<string, unknown>)
      partsByMessage.set(key, list)
    }

    for (const message of messages.rows) {
      const data = JSON.parse(String(message.data)) as Record<string, unknown>
      if (dialect.skipMessage(data)) continue
      const role = data.role === 'user' ? ('user' as const) : ('assistant' as const)
      const model = role === 'assistant' ? (data.modelID ?? data.modelId ?? null) : null

      const draftParts: Part[] = []
      for (const partData of partsByMessage.get(String(message.id)) ?? []) {
        const part = mapPart(partData, dialect, build.unknownPartCounts)
        if (part) draftParts.push(part)
      }
      if (!draftParts.length) continue

      if (role === 'user' && !firstPrompt) {
        const text = draftParts.find((p) => p.kind === 'text')
        if (text && text.kind === 'text') firstPrompt = text.text
      }

      drafts.push({
        id: String(message.id),
        at: Number(message.time_created),
        role,
        model: typeof model === 'string' ? model : null,
        parts: draftParts,
      })
    }

    if (!drafts.length) continue

    let title = String(session.title ?? '')
    if (dialect.normalizeTitle) title = dialect.normalizeTitle(title)
    if (!title) title = titleFromPrompt(firstPrompt) || '(untitled)'

    const trajectory: Trajectory = buildTrajectory({
      identity,
      rawId: sessionId,
      title,
      startedAt: Number(session.time_created),
      updatedAt: Number(session.time_updated),
      drafts,
    })
    build.trajectories.push(trajectory)
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
}

function mapPart(
  pd: Record<string, unknown>,
  dialect: OpencodeFamilyDialect,
  unknownCounts: Record<string, number>,
): Part | null {
  switch (pd.type) {
    case 'text': {
      if (pd.synthetic === true) return null
      const text = typeof pd.text === 'string' ? pd.text : ''
      return text ? { kind: 'text', text } : null
    }
    case 'reasoning': {
      const text = typeof pd.text === 'string' ? pd.text : ''
      return text ? truncatedReasoning(text) : null
    }
    case 'tool': {
      const state = (pd.state ?? {}) as Record<string, unknown>
      const rawOutput = typeof state.output === 'string' ? state.output : ''
      const rawError = typeof state.error === 'string' ? state.error : ''
      const payload: ToolCallPayload = {
        title:
          toolTitleFromInput(state.input) ??
          (typeof state.title === 'string' ? state.title : undefined),
        input: state.input,
        ...truncatedOutput(rawOutput || rawError),
      }
      if (state.status === 'error') payload.error = rawError || 'error'
      return toolPart(String(pd.tool ?? 'tool'), payload)
    }
    case 'file': {
      const mime = typeof pd.mime === 'string' ? pd.mime : 'application/octet-stream'
      // artifact/data URLs cannot be read here — keep the placeholder only
      const url = typeof pd.url === 'string' ? pd.url : ''
      const fileId = url.startsWith('data:')
        ? `${mime}@${url.length}`
        : url || String(pd.id ?? 'file')
      return {
        kind: 'attachment',
        files: [{ fileId: fileId.slice(0, 80), fileName: mime, fileSize: 0 }],
      }
    }
    default:
      return dialect.extraPart(pd, unknownCounts)
  }
}
