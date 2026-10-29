import { atom } from 'jotai'

import type { TrajectoryRow } from '@/app/derive'

import { allSourcesDataAtom } from './data'

export interface PaletteItem {
  readonly row: TrajectoryRow
  readonly text: string
}

/** Open/closed state of the ⌘K palette */
export const paletteOpenAtom = atom(false)

/** ⌘K index: built lazily on first open; jotai's own caching is the cache policy. No fuse.js. */
export const paletteIndexAtom = atom(async (get): Promise<readonly PaletteItem[]> => {
  const sources = await get(allSourcesDataAtom)
  return sources
    .filter((s) => s.status === 'ok')
    .flatMap((s) =>
      s.derived.rows.map((row) => ({ row, text: s.derived.paletteText.get(row.id) ?? row.title })),
    )
})

/** Plain scoring: title hits outrank body hits; a full scan over hundreds of rows is <1ms */
export function scorePaletteItem(item: PaletteItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const title = item.row.title.toLowerCase()
  if (title.includes(q)) return 100
  let score = 0
  let index = title.indexOf(q[0])
  if (index >= 0) {
    score = 40
    for (const ch of q) {
      index = title.indexOf(ch, index)
      if (index < 0) {
        score = 0
        break
      }
      index++
    }
  }
  if (score === 0 && item.text.toLowerCase().includes(q)) score = 10
  return score
}
