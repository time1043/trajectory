import { atom } from 'jotai'

import type { SourceDerived } from '@/app/derive'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceIndex } from '@/domain/ports/source-adapter'

import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { sourceAdapters } from '@/adapters/sources'
import { deriveSource } from '@/app/derive'
import { detectAdapter, ingestIndex } from '@/app/ingest'
import { atomFamily } from '@/lib/atom-family'

import {
  buildStaticSourceResult,
  STATIC_DATA_MODE,
  staticManifest,
  staticSourceGroups,
} from './static-data'

/** Bumped on HMR / manual refresh; downstream async atoms refetch automatically */
export const dataVersionAtom = atom(0)

export const sourcesManifestAtom = atom(async (get) => {
  get(dataVersionAtom)
  // static deployment: manifests are derived from the prebuilt /data/index.json
  if (STATIC_DATA_MODE) {
    const groups = await staticSourceGroups()
    return [...groups.values()].map((group) => staticManifest(group.dirName))
  }
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
 * by dirName; a dataVersion bump recomputes the dependency chain, but a file
 * fingerprint (Σ size + mtimeMs over the manifest) short-circuits unchanged
 * sources — they return the last result instead of re-ingesting, so a global
 * bump only re-loads the sources whose files actually changed.
 *
 * Static mode (VITE_DATA_MODE=static) skips /@api/sources and /@api/file
 * entirely: the index comes from the prebuilt /data/index.json.
 */
export const sourceIndexFamily = atomFamily((dirName: string) => {
  // the result and the fingerprint that produced it, per family member
  let lastFp: number | null = null
  let lastResult: SourceLoadResult | null = null
  return atom(async (get): Promise<SourceLoadResult> => {
    get(dataVersionAtom)
    if (STATIC_DATA_MODE) return buildStaticSourceResult(dirName)
    const manifests = await get(sourcesManifestAtom)
    const manifest = manifests.find((m) => m.dirName === dirName)
    if (!manifest) return { status: 'error', dirName, error: 'manifest gone' }
    const fp = manifest.files.reduce((s, f) => s + f.size + f.mtimeMs, 0)
    if (lastResult && fp === lastFp) return lastResult
    const adapter = detectAdapter(sourceAdapters, manifest)
    if (!adapter) {
      lastFp = fp
      lastResult = { status: 'unrecognized', manifest }
      return lastResult
    }
    try {
      const index = await ingestIndex(adapter, manifest, sanitizer)
      const identity = {
        sourceId: index.sourceId,
        provider: index.provider,
        providerLabel: index.providerLabel,
        user: index.user,
      }
      lastFp = fp
      lastResult = { status: 'ok', dirName, identity, index, derived: deriveSource(index) }
      return lastResult
    } catch (error) {
      // never cache errors — a read that raced a live write should retry on
      // the next dataVersion bump
      return { status: 'error', dirName, error }
    }
  })
})

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
