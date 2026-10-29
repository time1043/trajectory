import { atom } from 'jotai'

import type { SourceDerived } from '@/app/derive'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceIndex } from '@/domain/ports/source-adapter'

import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { sourceAdapters } from '@/adapters/sources'
import { deriveSource } from '@/app/derive'
import { detectAdapter, ingestIndex } from '@/app/ingest'
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
  readonly identity: { sourceId: string; provider: string; providerLabel: string; user: string }
  readonly index: SourceIndex
  readonly derived: SourceDerived
}
export type SourceLoadResult = LoadedSource | UnrecognizedSource | SourceLoadError

const sanitizer = createRegexSanitizer({ sanitizeText: false })

/**
 * Per-source index load: detect -> ingestIndex -> derive. atomFamily caches
 * by dirName; a dataVersion bump recomputes the whole dependency chain and
 * old values go to GC — a local dev tool with <100MB of index data does not
 * need an LRU.
 */
export const sourceIndexFamily = atomFamily((dirName: string) =>
  atom(async (get): Promise<SourceLoadResult> => {
    get(dataVersionAtom)
    const manifests = await get(sourcesManifestAtom)
    const manifest = manifests.find((m) => m.dirName === dirName)
    if (!manifest) return { status: 'error', dirName, error: 'manifest gone' }
    const adapter = detectAdapter(sourceAdapters, manifest)
    if (!adapter) return { status: 'unrecognized', manifest }
    try {
      const index = await ingestIndex(adapter, manifest, sanitizer)
      const identity = {
        sourceId: index.sourceId,
        provider: index.provider,
        providerLabel: index.providerLabel,
        user: index.user,
      }
      return { status: 'ok', dirName, identity, index, derived: deriveSource(index) }
    } catch (error) {
      return { status: 'error', dirName, error }
    }
  }),
)

export const allSourcesDataAtom = atom(async (get) => {
  const manifests = await get(sourcesManifestAtom)
  return Promise.all(manifests.map((m) => get(sourceIndexFamily(m.dirName))))
})

/** Merged lightweight rows, updatedAt descending */
export const allRowsAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources
    .flatMap((s) => (s.status === 'ok' ? s.derived.rows : []))
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

/** All session summaries merged across sources (frozen by ingest) */
export const allSessionsAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.flatMap((s) => (s.status === 'ok' ? s.index.sessions : []))
})

/** Source metadata for the sidebar (provider dots / labels), unrecognized dirs included */
export const sourceMetasAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.map((s) => {
    if (s.status === 'ok')
      return {
        id: s.identity.sourceId,
        provider: s.identity.provider,
        user: s.identity.user,
        label: `${s.identity.providerLabel} · ${s.identity.user}`,
        count: s.index.sessions.length,
        ok: true as const,
      }
    if (s.status === 'unrecognized')
      return {
        id: s.manifest.dirName,
        provider: s.manifest.dirName,
        user: '',
        label: s.manifest.dirName,
        count: 0,
        ok: false as const,
      }
    return {
      id: s.dirName,
      provider: s.dirName,
      user: '',
      label: s.dirName,
      count: 0,
      ok: false as const,
    }
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
        s.identity.sourceId,
        { providerLabel: s.identity.providerLabel, user: s.identity.user },
      ]),
  )
})

/** dirName -> manifest, for the body loader to find its adapter */
export const manifestByDirNameAtom = atom(async (get) => {
  const manifests = await get(sourcesManifestAtom)
  return new Map(manifests.map((m) => [m.dirName, m]))
})
