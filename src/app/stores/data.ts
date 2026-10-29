import { atom } from 'jotai'

import type { SourceDerived } from '@/app/derive'
import type { ParsedSource } from '@/domain/model/trajectory'
import type { SourceManifest } from '@/domain/ports/data-host'

import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { sourceAdapters } from '@/adapters/sources'
import { deriveSource } from '@/app/derive'
import { detectAdapter, ingest } from '@/app/ingest'
import { atomFamily } from '@/lib/atom-family'

/** Bumped on HMR / manual refresh; downstream async atoms refetch automatically */
export const dataVersionAtom = atom(0)

export const sourcesManifestAtom = atom(async (get) => {
  get(dataVersionAtom)
  const res = await fetch('/@api/sources')
  if (!res.ok) throw new Error(`[trajectory] /@api/sources: ${res.status}`)
  return (await res.json()) as SourceManifest[]
})

export interface UnrecognizedSource {
  readonly status: 'unrecognized'
  readonly manifest: SourceManifest
}
export interface SourceLoadError {
  readonly status: 'error'
  readonly dirName: string
  readonly error: unknown
}
export interface LoadedSource {
  readonly status: 'ok'
  readonly dirName: string
  readonly parsed: ParsedSource
  readonly derived: SourceDerived
}
export type SourceLoadResult = LoadedSource | UnrecognizedSource | SourceLoadError

const sanitizer = createRegexSanitizer({ sanitizeText: false })

/**
 * Per-source load: detect -> ingest -> derive. atomFamily caches by dirName;
 * a dataVersion bump recomputes the whole dependency chain and old values go
 * to GC — a local dev tool with <100MB data does not need an LRU.
 */
export const sourceDataFamily = atomFamily((dirName: string) =>
  atom(async (get): Promise<SourceLoadResult> => {
    get(dataVersionAtom)
    const manifests = await get(sourcesManifestAtom)
    const manifest = manifests.find((m) => m.dirName === dirName)
    if (!manifest) return { status: 'error', dirName, error: 'manifest gone' }
    const adapter = detectAdapter(sourceAdapters, manifest)
    if (!adapter) return { status: 'unrecognized', manifest }
    try {
      const parsed = await ingest(adapter, manifest, sanitizer)
      return { status: 'ok', dirName, parsed, derived: deriveSource(parsed) }
    } catch (error) {
      return { status: 'error', dirName, error }
    }
  }),
)

export const allSourcesDataAtom = atom(async (get) => {
  const manifests = await get(sourcesManifestAtom)
  return Promise.all(manifests.map((m) => get(sourceDataFamily(m.dirName))))
})

/** All trajectories merged across sources (frozen by ingest) */
export const allTrajectoriesAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.flatMap((s) => (s.status === 'ok' ? s.parsed.trajectories : []))
})

/** Merged lightweight rows, updatedAt descending */
export const allRowsAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources
    .flatMap((s) => (s.status === 'ok' ? s.derived.rows : []))
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

/** Source metadata for the sidebar (provider dots / labels), unrecognized dirs included */
export const sourceMetasAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.map((s) => {
    if (s.status === 'ok')
      return {
        id: s.parsed.sourceId,
        provider: s.parsed.provider,
        user: s.parsed.user,
        label: `${s.parsed.providerLabel} · ${s.parsed.user}`,
        count: s.parsed.trajectories.length,
        ok: true as const,
      }
    if (s.status === 'unrecognized')
      return { id: s.manifest.dirName, label: s.manifest.dirName, count: 0, ok: false as const }
    return { id: s.dirName, label: s.dirName, count: 0, ok: false as const }
  })
})

/**
 * Provider label + user per source id. The sidebar composes '<provider> ·
 * <user>'; the reading view orders its meta line as provider -> models ->
 * user. One source of parts, per-surface composition.
 */
export const sourcePartsAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return new Map(
    sources
      .filter((s) => s.status === 'ok')
      .map((s) => [
        s.parsed.sourceId,
        { providerLabel: s.parsed.providerLabel, user: s.parsed.user },
      ]),
  )
})
