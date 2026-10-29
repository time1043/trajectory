/**
 * DataHost port — what the local host (vite plugin `plugins/trajectory-data.ts`)
 * exposes to the browser: manifests, raw bytes, read-only SQLite queries and
 * change events. The node side stays format-agnostic; adapters own schemas.
 */

export interface SourceFileEntry {
  path: string
  size: number
  mtimeMs: number
}

export interface SourceManifest {
  /** Two-level path relative to data/, e.g. 'web/deepseek' */
  dirName: string
  /** Recursive listing; transient sqlite sidecars and dotfiles excluded */
  files: SourceFileEntry[]
}

/** Only paths registered in a manifest may be fetched or queried */
export type FetchDataFile = (path: string) => Promise<ArrayBuffer>

export interface SqliteQueryResult {
  rows: Record<string, unknown>[]
}

export type QuerySqlite = (
  path: string,
  sql: string,
  params?: readonly unknown[],
) => Promise<SqliteQueryResult>

/** HMR custom event name — keep in sync with plugins/trajectory-data.ts */
export const DATA_API_HMR_EVENT = 'trajectory:data-changed'
