import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { SessionSearch } from '@/app/stores/session-filter'

import { applySessionFilters } from '@/app/stores/session-filter'
import { sessionTagsAtom } from '@/app/stores/tags'

import { allSourcesDataAtom } from './data'

/** Read side only — the search params (URL) stay the single truth */
export function useSessionRows(search: SessionSearch) {
  const sources = useAtomValue(allSourcesDataAtom)
  const tagsBySession = useAtomValue(sessionTagsAtom)
  const { q, sources: sourceKeys, tags: tagKeys, from, to } = search
  return useMemo(() => {
    const items = sources.flatMap((s) =>
      s.status === 'ok'
        ? s.derived.rows.map((row) => ({ row, text: s.derived.paletteText.get(row.id) ?? '' }))
        : [],
    )
    const tagMap = new Map(Object.entries(tagsBySession))
    return applySessionFilters(items, { q, sources: sourceKeys, tags: tagKeys, from, to }, tagMap)
  }, [sources, tagsBySession, q, sourceKeys, tagKeys, from, to])
}
