import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { Trajectory } from '@/domain/model/trajectory'

import { applySessionFilters, type SessionSearch } from '@/app/stores/session-filter'
import { sessionTagsAtom } from '@/app/stores/tags'

import { allSourcesDataAtom } from './data'

export type { SessionSearch }
export {
  parseListParam,
  sourceKey,
  stringifyListParam,
  toggleSource,
} from '@/app/stores/session-filter'

/**
 * Merged lightweight rows through the pure filter pipeline. The search params
 * (URL) stay the single truth — this hook is the read side only.
 */
export function useSessionRows(search: SessionSearch) {
  const sources = useAtomValue(allSourcesDataAtom)
  const tagsBySession = useAtomValue(sessionTagsAtom)
  const { q, from, to } = search
  return useMemo(() => {
    const items = sources.flatMap((s) =>
      s.status === 'ok'
        ? s.derived.rows.map((row) => ({ row, text: s.derived.paletteText.get(row.id) ?? '' }))
        : [],
    )
    const trajectories = new Map<string, Trajectory>()
    for (const s of sources) {
      if (s.status === 'ok') {
        for (const t of s.parsed.trajectories) trajectories.set(t.id, t)
      }
    }
    const tagMap = new Map(Object.entries(tagsBySession))
    return applySessionFilters(
      items,
      { q, sources: search.sources, tags: search.tags, from, to },
      trajectories,
      tagMap,
    )
  }, [sources, tagsBySession, q, search.sources, search.tags, from, to])
}
