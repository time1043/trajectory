import type { EpochMs, SourceId, TrajectoryId } from '../model/identity'
import type { ParseDiagnostics, PersonaProfile, Trajectory } from '../model/trajectory'
export type { Trajectory }
import type { SourceFileEntry, SourceManifest, QuerySqlite } from './data-host'

export type { SourceFileEntry, SourceManifest }

/**
 * Everything the dashboard, list, palette and tag counts need — derived at
 * index time WITHOUT touching session bodies. turnStarts feeds the analytics
 * (same accounting as buildTurns: consecutive user nodes merge into one turn).
 */
export interface SessionSummary {
  readonly id: TrajectoryId
  readonly sessionId: string
  readonly title: string
  readonly startedAt: EpochMs
  readonly updatedAt: EpochMs
  readonly turnStarts: readonly EpochMs[]
  readonly messageCount: number
  readonly firstPrompt: string
}

export interface SourceIndex {
  readonly sourceId: SourceId
  readonly provider: string
  readonly providerLabel: string
  readonly user: string
  readonly profile: PersonaProfile | null
  readonly sessions: readonly SessionSummary[]
  readonly diagnostics: ParseDiagnostics
}

/**
 * Plugin contract for an external data source. Implementations are isomorphic
 * pure functions — no react/jotai/vite imports, no direct node APIs; bytes via
 * fetchFile, structured SQLite reads via querySqlite. Adding a source = new
 * directory + one registry line.
 */
export interface SourceAdapter {
  readonly id: string
  readonly label: string
  /** Claim a manifest if its files belong to this adapter */
  detect(manifest: SourceManifest): boolean
  /** Light pass: session summaries only (no bodies) */
  index(input: SourceParseInput): Promise<SourceIndex>
  /** Full pass: one session's body, on demand */
  loadSession(input: SourceParseInput, sessionId: string): Promise<Trajectory | null>
  /** Source-specific PII locations, for the future sanitizer */
  readonly piiHints?: readonly string[]
}

export interface SourceParseInput {
  manifest: SourceManifest
  fetchFile(path: string): Promise<ArrayBuffer>
  querySqlite: QuerySqlite
}

/**
 * Data layout is <group>/<provider>/<user>/<data...> — one manifest per user
 * directory, and the identity carries both segments so multiple users of the
 * same product never collide.
 */
export interface SourceIdentity {
  readonly sourceId: SourceId
  readonly provider: string
  readonly providerLabel: string
  readonly user: string
}

export function sourceIdentity(
  manifest: SourceManifest,
  provider: string,
  providerLabel: string,
): SourceIdentity {
  const user = manifest.dirName.split('/').pop() ?? manifest.dirName
  return { sourceId: `${provider}:${user}`, provider, providerLabel, user }
}
