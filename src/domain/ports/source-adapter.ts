import type { SourceId } from '../model/identity'
import type { ParsedSource } from '../model/trajectory'
import type { SourceFileEntry, SourceManifest, QuerySqlite } from './data-host'

export type { SourceFileEntry, SourceManifest }

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
  parse(input: SourceParseInput): Promise<ParsedSource>
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
  readonly providerLabel: string
  readonly user: string
}

export function sourceIdentity(
  manifest: SourceManifest,
  provider: string,
  providerLabel: string,
): SourceIdentity {
  const user = manifest.dirName.split('/').pop() ?? manifest.dirName
  return { sourceId: `${provider}:${user}`, providerLabel, user }
}
