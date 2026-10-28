import type { SourceFileEntry, SourceManifest } from './data-host'
import type { ParsedSource } from '../model/trajectory'

export type { SourceFileEntry, SourceManifest }

/**
 * Plugin contract for an external data source. Implementations are isomorphic
 * pure functions — no react/jotai/vite/node imports, bytes only via fetchFile.
 * Adding a source = new directory + one registry line.
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
}
