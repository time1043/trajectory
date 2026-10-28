/**
 * DataHost port — what the local host (vite plugin `plugins/trajectory-data.ts`)
 * exposes to the browser: manifests, raw bytes, change events. Node side stays
 * filesystem-only; all parsing lives in browser-side adapters.
 */

export interface SourceFileEntry {
  path: string
  size: number
  mtimeMs: number
}

export interface SourceManifest {
  /** Two-level path relative to data/, e.g. 'web/deepseek' */
  dirName: string
  files: SourceFileEntry[]
}

/** Only paths registered in a manifest may be fetched */
export type FetchDataFile = (path: string) => Promise<ArrayBuffer>

export interface DataChangeEvent {
  path: string
}

/** HMR custom event name — keep in sync with plugins/trajectory-data.ts */
export const DATA_API_HMR_EVENT = 'trajectory:data-changed'
