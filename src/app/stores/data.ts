import { atom } from 'jotai'

import type { ParsedSource } from '@/domain/model/trajectory'
import type { SourceManifest } from '@/domain/ports/data-host'
import { sourceAdapters } from '@/adapters/sources'
import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { deriveSource } from '@/app/derive'
import type { SourceDerived } from '@/app/derive'
import { detectAdapter, ingest } from '@/app/ingest'
import { atomFamily } from '@/lib/atom-family'

/** HMR / 手动刷新时 bump；下游 async atom 依赖它自动重取 */
export const dataVersionAtom = atom(0)

export const sourcesManifestAtom = atom(async (get) => {
  get(dataVersionAtom)
  const res = await fetch('/@api/sources')
  if (!res.ok)
    throw new Error(`[trajectory] /@api/sources: ${res.status}`)
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
 * 单来源加载：detect → ingest(parse→sanitize→invariants→freeze) → derive。
 * atomFamily 按 dirName 缓存；dataVersion 变化时依赖链整体重算，
 * 旧值交由 GC——dev 工具单机数据 <40MB，不写 LRU。
 */
export const sourceDataFamily = atomFamily((dirName: string) =>
  atom(async (get): Promise<SourceLoadResult> => {
    get(dataVersionAtom)
    const manifests = await get(sourcesManifestAtom)
    const manifest = manifests.find(m => m.dirName === dirName)
    if (!manifest)
      return { status: 'error', dirName, error: 'manifest gone' }
    const adapter = detectAdapter(sourceAdapters, manifest)
    if (!adapter)
      return { status: 'unrecognized', manifest }
    try {
      const parsed = await ingest(adapter, manifest, sanitizer)
      return { status: 'ok', dirName, parsed, derived: deriveSource(parsed) }
    }
    catch (error) {
      return { status: 'error', dirName, error }
    }
  }),
)

export const allSourcesDataAtom = atom(async (get) => {
  const manifests = await get(sourcesManifestAtom)
  return Promise.all(manifests.map(m => get(sourceDataFamily(m.dirName))))
})

/** 多来源合并后的全部 Trajectory（readonly；冻结由 ingest 保证） */
export const allTrajectoriesAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.flatMap(s => (s.status === 'ok' ? s.parsed.trajectories : []))
})

/** 合并轻量行（updatedAt desc；deriveSource 内已排序，合并后重排） */
export const allRowsAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources
    .flatMap(s => (s.status === 'ok' ? s.derived.rows : []))
    .sort((a, b) => b.updatedAt - a.updatedAt)
})

/** 来源 meta（侧栏 provider 圆点/标签），含未识别目录 */
export const sourceMetasAtom = atom(async (get) => {
  const sources = await get(allSourcesDataAtom)
  return sources.map((s) => {
    if (s.status === 'ok')
      return { id: s.parsed.sourceId, label: s.parsed.label, count: s.parsed.trajectories.length, ok: true as const }
    if (s.status === 'unrecognized')
      return { id: s.manifest.dirName, label: s.manifest.dirName, count: 0, ok: false as const }
    return { id: s.dirName, label: s.dirName, count: 0, ok: false as const }
  })
})
