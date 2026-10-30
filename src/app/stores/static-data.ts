import type { TrajectoryId } from '@/domain/model/identity'
import type { Trajectory } from '@/domain/model/trajectory'
import type { QuerySqlite, SourceManifest, SqliteQueryResult } from '@/domain/ports/data-host'
import type { SessionSummary, SourceAdapter, SourceIndex } from '@/domain/ports/source-adapter'

import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { claudeAdapter } from '@/adapters/sources/claude/adapter'
import { codexAdapter } from '@/adapters/sources/codex/adapter'
import { opencodeAdapter } from '@/adapters/sources/opencode/adapter'
import { piAdapter } from '@/adapters/sources/pi/adapter'
import { workbuddyAdapter } from '@/adapters/sources/workbuddy/adapter'
import { zcodeAdapter } from '@/adapters/sources/zcode/adapter'
import { deriveSource } from '@/app/derive'

import type { SourceLoadResult } from './data'

/**
 * Static data mode (`VITE_DATA_MODE=static`): a deployed build reads the
 * prebuilt snapshot that scripts/build-public-data.mjs emits under /data/ —
 * index.json (session summaries) plus sessions/<id>.json (one raw body per
 * session) — instead of the dev plugin's /@api/* endpoints.
 */
export const STATIC_DATA_MODE = import.meta.env.VITE_DATA_MODE === 'static'

/** One index.json entry — the summary shape build-public-data.mjs emits */
export interface StaticSummary {
  readonly id: string
  readonly sessionId: string
  readonly provider: string
  readonly user: string
  readonly title: string
  readonly startedAt: number
  readonly updatedAt: number
  readonly turnStarts: readonly number[]
  readonly messageCount: number
  readonly firstPrompt: string
}

/**
 * One sessions/<id>.json body. The file stores the session's RAW source data
 * (never a parsed Trajectory) so the static loader can feed it back through
 * the real adapter's loadSession — the adapters stay the only parsing truth:
 * - jsonl sources (claude-code / codex / pi): the session file's lines
 * - sqlite sources (zcode / opencode): exactly the rows the adapter's three
 *   per-session queries return (session row, message rows, part rows)
 */
export interface StaticSessionBody {
  readonly id?: string
  readonly lines?: readonly unknown[]
  readonly session?: Record<string, unknown>[]
  readonly messages?: Record<string, unknown>[]
  readonly parts?: Record<string, unknown>[]
}

export interface StaticSourceGroup {
  readonly dirName: string
  readonly provider: string
  readonly user: string
  readonly summaries: StaticSummary[]
}

/**
 * The static index carries the provider DIRECTORY segment, which for every
 * source layout equals the adapter's provider string ('local/claude-code/…'
 * -> 'claude-code'). Directories without an entry here surface as
 * 'unrecognized' sources — same as the dev server shows them.
 *
 * Single-file multi-session sources (deepseek's conversations.json, qwen's
 * chat-export-*.json) are absent on purpose: the publish flow cannot copy
 * one of their sessions into data-public/, so they never reach a static
 * build.
 */
const ADAPTER_BY_PROVIDER: Readonly<Record<string, SourceAdapter>> = {
  'claude-code': claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  pi: piAdapter,
  workbuddy: workbuddyAdapter,
  zcode: zcodeAdapter,
}

const sanitizer = createRegexSanitizer({ sanitizeText: false })

// ---------------------------------------------------------------------------
// index.json -> per-source groups
// ---------------------------------------------------------------------------

let summariesPromise: Promise<readonly StaticSummary[]> | null = null

/** Fetch + cache the prebuilt index (BASE_URL-aware for project-page subpaths) */
export function fetchStaticSummaries(): Promise<readonly StaticSummary[]> {
  summariesPromise ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}data/index.json`)
    if (!res.ok) throw new Error(`[trajectory] /data/index.json: ${res.status}`)
    return (await res.json()) as StaticSummary[]
  })()
  return summariesPromise
}

let groupsPromise: Promise<ReadonlyMap<string, StaticSourceGroup>> | null = null

/** Summaries grouped into sources keyed by '<provider>/<user>' (the static dirName) */
export function staticSourceGroups(): Promise<ReadonlyMap<string, StaticSourceGroup>> {
  groupsPromise ??= fetchStaticSummaries().then((summaries) => {
    const groups = new Map<string, StaticSourceGroup>()
    for (const summary of summaries) {
      if (!summary?.provider || !summary?.user) continue
      const dirName = `${summary.provider}/${summary.user}`
      const group = groups.get(dirName)
      if (group) group.summaries.push(summary)
      else
        groups.set(dirName, {
          dirName,
          provider: summary.provider,
          user: summary.user,
          summaries: [summary],
        })
    }
    return groups
  })
  return groupsPromise
}

/** Synthetic manifest for a static source — no filesystem behind a deployed build */
export function staticManifest(dirName: string): SourceManifest {
  return { dirName, files: [] }
}

function toSessionSummary(raw: StaticSummary): SessionSummary {
  return {
    id: raw.id,
    sessionId: raw.sessionId,
    title: raw.title ?? '',
    startedAt: Number(raw.startedAt ?? 0),
    updatedAt: Number(raw.updatedAt ?? 0),
    turnStarts: Array.isArray(raw.turnStarts) ? raw.turnStarts.map(Number) : [],
    messageCount: Number(raw.messageCount ?? 0),
    firstPrompt: raw.firstPrompt ?? '',
  }
}

/** SourceLoadResult for one static source: adapter-derived, or unrecognized */
export async function buildStaticSourceResult(dirName: string): Promise<SourceLoadResult> {
  const groups = await staticSourceGroups()
  const group = groups.get(dirName)
  if (!group) return { status: 'error', dirName, error: 'not in static index' }

  const adapter = ADAPTER_BY_PROVIDER[group.provider]
  if (!adapter) return { status: 'unrecognized', manifest: staticManifest(dirName) }

  const index = deepFreeze({
    sourceId: `${group.provider}:${group.user}`,
    provider: group.provider,
    providerLabel: adapter.label,
    user: group.user,
    profile: null,
    sessions: group.summaries.map(toSessionSummary),
    diagnostics: { unknownPartCounts: {}, invariantViolations: [] },
  } satisfies SourceIndex)

  return {
    status: 'ok',
    dirName,
    identity: {
      sourceId: index.sourceId,
      provider: index.provider,
      providerLabel: index.providerLabel,
      user: index.user,
    },
    index,
    derived: deriveSource(index),
  }
}

// ---------------------------------------------------------------------------
// sessions/<id>.json -> Trajectory (through the real adapter)
// ---------------------------------------------------------------------------

/** sqlite adapter never receives file bytes in static mode */
async function unreachableFetchFile(): Promise<ArrayBuffer> {
  throw new Error('[trajectory] static mode: no file bytes behind a sqlite source')
}

/** jsonl adapter never receives sqlite queries in static mode */
async function unreachableQuerySqlite(): Promise<SqliteQueryResult> {
  throw new Error('[trajectory] static mode: no sqlite behind a jsonl source')
}

/**
 * The adapter's loadSession runs exactly three per-session queries against its
 * db (opencode-family schema); the static body pre-answers them. Dispatch on
 * the FROM table — the id/session_id filters are already baked into the body.
 */
const staticQuerySqlite =
  (body: StaticSessionBody): QuerySqlite =>
  async (_path, sql) => {
    const lowered = sql.toLowerCase()
    if (lowered.includes('from message')) return { rows: body.messages ?? [] }
    if (lowered.includes('from part')) return { rows: body.parts ?? [] }
    if (lowered.includes('from session')) return { rows: body.session ?? [] }
    throw new Error(`[trajectory] static mode: unsupported sqlite query: ${sql.slice(0, 100)}`)
  }

/** jsonl body: re-serialize the stored lines, served through a synthetic fetchFile */
async function loadJsonlStaticBody(
  adapter: SourceAdapter,
  body: StaticSessionBody,
  manifest: SourceManifest,
  sessionId: string,
): Promise<Trajectory | null> {
  const text = (body.lines ?? []).map((line) => JSON.stringify(line)).join('\n')
  const bytes = new TextEncoder().encode(text)
  return adapter.loadSession(
    {
      manifest,
      fetchFile: async () => bytes.buffer as ArrayBuffer,
      querySqlite: unreachableQuerySqlite,
    },
    sessionId,
  )
}

async function loadSqliteStaticBody(
  adapter: SourceAdapter,
  body: StaticSessionBody,
  manifest: SourceManifest,
  sessionId: string,
): Promise<Trajectory | null> {
  // both opencode-family db names so whichever adapter claims finds its file
  return adapter.loadSession(
    { manifest, fetchFile: unreachableFetchFile, querySqlite: staticQuerySqlite(body) },
    sessionId,
  )
}

/**
 * One session's full trajectory in static mode: fetch the raw body file, pick
 * the adapter by the id's provider segment, and let the real loadSession parse
 * it. Same sanitize -> freeze tail as the dev ingest pipeline.
 */
export async function loadStaticSessionBody(id: TrajectoryId): Promise<Trajectory | null> {
  const [provider, user, ...rest] = id.split(':')
  const sessionId = rest.join(':')
  const adapter = provider && user && sessionId ? ADAPTER_BY_PROVIDER[provider] : undefined
  if (!adapter || !user || !sessionId) return null

  let body: StaticSessionBody
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/sessions/${id}.json`)
    if (!res.ok) return null
    body = (await res.json()) as StaticSessionBody
  } catch {
    return null
  }

  // paths are dirName-prefixed like the dev plugin's manifests (the sqlite
  // adapters match '/db.sqlite' / '/opencode.db' suffixes); jsonl adapters
  // match the session file by basename or suffix, so the single
  // '<sessionId>.jsonl' entry satisfies all of them
  const dirName = `${provider}/${user}`
  const manifest: SourceManifest = {
    dirName,
    files: [
      { path: `${dirName}/${sessionId}.jsonl`, size: 0, mtimeMs: 0 },
      { path: `${dirName}/db.sqlite`, size: 0, mtimeMs: 0 },
      { path: `${dirName}/opencode.db`, size: 0, mtimeMs: 0 },
    ],
  }

  try {
    const raw = Array.isArray(body.lines)
      ? await loadJsonlStaticBody(adapter, body, manifest, sessionId)
      : await loadSqliteStaticBody(adapter, body, manifest, sessionId)
    if (!raw) return null
    return deepFreeze(sanitizer.sanitizeSession(raw))
  } catch (error) {
    console.warn(`[trajectory] static session body failed: ${id}`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// freeze — same semantics as ingest.ts deepFreeze (adapters return Maps)
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value instanceof Map) {
    Object.freeze(value)
    for (const key of value.keys()) deepFreeze(key)
    for (const item of value.values()) deepFreeze(item)
  } else if (value instanceof Set) {
    Object.freeze(value)
    for (const item of value) deepFreeze(item)
  } else if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  }
  return value
}
