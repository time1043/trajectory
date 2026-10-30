import type { Part, ToolCallPayload } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'
import type { QuerySqlite } from '@/domain/ports/data-host'
import type { SourceIdentity, SourceIndex, SessionSummary } from '@/domain/ports/source-adapter'

import {
  buildTrajectory,
  titleFromPrompt,
  toolPart,
  toolTitleFromInput,
  truncatedOutput,
  truncatedReasoning,
  type NodeDraft,
} from './common'

/**
 * Shared index/load for the opencode-family schema (session/message/part
 * tables with JSON `data` columns) — zcode is a superset of opencode.
 *
 * index() runs aggregate SQL (sessions, a message SKELETON with only the
 * json_extract fields the filters need, first prompts) and never touches part
 * bodies — the 100MB+ of JSON stays in sqlite until a session is opened.
 * loadSession() runs the existing per-session queries for one session.
 */
export interface OpencodeFamilyDialect {
  sessionsSql: string
  /** one row per visible message: sid / role / at (+ dialect fields for skipMessage) */
  skeletonSql: string
  /** self-contained: first visible user text per session, 240 chars */
  firstPromptSql: string
  sessionByIdSql: string
  messagesSql: string
  partsSql: string
  /** Index-time noise filter over the extracted skeleton fields */
  skipSkeleton(skel: {
    role: string | null
    kind: string | null
    origin: string | null
    vis: string | null
  }): boolean
  /** Load-time noise filter over the raw message data */
  skipMessageData(data: Record<string, unknown>): boolean
  /** Dialect-specific part kinds; return null to skip */
  extraPart(data: Record<string, unknown>): Part | null
  filterSession?(row: Record<string, unknown>): boolean
  normalizeTitle?(title: string): string
}

export async function indexOpencodeFamily(opts: {
  querySqlite: QuerySqlite
  identity: SourceIdentity
  dbPath: string
  dialect: OpencodeFamilyDialect
}): Promise<SourceIndex> {
  const { querySqlite, dialect, identity, dbPath } = opts
  const sessions = (await querySqlite(dbPath, dialect.sessionsSql)).rows as Record<
    string,
    unknown
  >[]
  const skeletons = (await querySqlite(dbPath, dialect.skeletonSql)).rows as {
    sid: string
    role: string | null
    kind: string | null
    origin: string | null
    vis: string | null
    at: number
  }[]
  const firstPrompts = (await querySqlite(dbPath, dialect.firstPromptSql)).rows as {
    sid: string
    txt: string | null
  }[]
  const promptBySession = new Map(firstPrompts.map((r) => [String(r.sid), String(r.txt ?? '')]))

  const turnStartsBySession = new Map<string, number[]>()
  const messageCountBySession = new Map<string, number>()
  let previousRole: string | null = null
  let previousSid: string | null = null
  for (const row of skeletons) {
    const sid = String(row.sid)
    if (sid !== previousSid) previousRole = null // turn boundary between sessions
    if (
      dialect.skipSkeleton({
        role: row.role ?? null,
        kind: row.kind ?? null,
        origin: row.origin ?? null,
        vis: row.vis ?? null,
      })
    )
      continue
    if (row.role === 'user' && previousRole !== 'user') {
      const list = turnStartsBySession.get(sid) ?? []
      list.push(Number(row.at))
      turnStartsBySession.set(sid, list)
    }
    messageCountBySession.set(sid, (messageCountBySession.get(sid) ?? 0) + 1)
    previousRole = row.role ?? null
    previousSid = sid
  }

  const summaries: SessionSummary[] = []
  for (const raw of sessions) {
    if (dialect.filterSession?.(raw)) continue
    const sessionId = String(raw.id)
    const turnStarts = turnStartsBySession.get(sessionId) ?? []
    if (!turnStarts.length) continue // nothing visible -> nothing to list

    let title = String(raw.title ?? '')
    if (dialect.normalizeTitle) title = dialect.normalizeTitle(title)
    if (!title) title = promptBySession.get(sessionId) || '(untitled)'

    summaries.push({
      id: `${identity.sourceId}:${sessionId}`,
      sessionId,
      title,
      startedAt: Number(raw.time_created),
      updatedAt: Number(raw.time_updated),
      turnStarts,
      messageCount: messageCountBySession.get(sessionId) ?? 0,
      firstPrompt: promptBySession.get(sessionId) ?? '',
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
}

export async function loadOpencodeFamilySession(opts: {
  querySqlite: QuerySqlite
  identity: SourceIdentity
  sessionId: string
  dbPath: string
  dialect: OpencodeFamilyDialect
}): Promise<Trajectory | null> {
  const { querySqlite, dialect, identity } = opts

  const sessionRows = (await querySqlite(opts.dbPath, dialect.sessionByIdSql, [opts.sessionId]))
    .rows
  const session = sessionRows[0]
  if (!session) return null

  const messages = (await querySqlite(opts.dbPath, dialect.messagesSql, [opts.sessionId])).rows as {
    id: string
    time_created: number
    data: string
  }[]
  const parts = (await querySqlite(opts.dbPath, dialect.partsSql, [opts.sessionId])).rows as {
    message_id: string
    data: string
  }[]

  const partsByMessage = new Map<string, Record<string, unknown>[]>()
  for (const row of parts) {
    const key = String(row.message_id)
    const list = partsByMessage.get(key) ?? []
    list.push(JSON.parse(String(row.data)) as Record<string, unknown>)
    partsByMessage.set(key, list)
  }

  const drafts: NodeDraft[] = []
  for (const message of messages) {
    const data = JSON.parse(String(message.data)) as Record<string, unknown>
    if (dialect.skipMessageData(data)) continue
    const role = data.role === 'user' ? ('user' as const) : ('assistant' as const)
    const model = role === 'assistant' ? (data.modelID ?? data.modelId ?? null) : null

    const draftParts: Part[] = []
    for (const partData of partsByMessage.get(String(message.id)) ?? []) {
      const part = mapPart(partData, dialect)
      if (part) draftParts.push(part)
    }
    if (!draftParts.length) continue

    drafts.push({
      id: String(message.id),
      at: Number(message.time_created),
      role,
      model: typeof model === 'string' ? model : null,
      parts: draftParts,
    })
  }

  if (!drafts.length) return null

  let title = String(session.title ?? '')
  if (dialect.normalizeTitle) title = dialect.normalizeTitle(title)
  // match the index pass: "New session - <ISO>" and empty titles fall back to
  // the first real user prompt — the reading view renders trajectory.title
  // (routes/sessions.$source.$user.$session.tsx) and must not disagree with
  // the session list
  const firstPrompt = firstUserPrompt(drafts)

  return buildTrajectory({
    identity,
    rawId: opts.sessionId,
    title: title || titleFromPrompt(firstPrompt),
    startedAt: Number(session.time_created),
    updatedAt: Number(session.time_updated),
    drafts,
  })
}

/** First visible user text among the drafts (synthetic text parts already dropped) */
function firstUserPrompt(drafts: readonly NodeDraft[]): string {
  const part = drafts.find((d) => d.role === 'user')?.parts.find((p) => p.kind === 'text')
  return part?.kind === 'text' ? part.text : ''
}

function mapPart(pd: Record<string, unknown>, dialect: OpencodeFamilyDialect): Part | null {
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
      return dialect.extraPart(pd)
  }
}
