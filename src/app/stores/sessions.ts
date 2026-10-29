import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { TrajectoryRow } from '@/app/derive'
import type { Trajectory } from '@/domain/model/trajectory'

import { buildTurns } from '@/domain/services/turn-builder'

import { allSourcesDataAtom } from './data'

/** Search param shape of the /sessions route (URL is the truth, jotai does not mirror it) */
export interface SessionSearch {
  q?: string
  from?: string
  to?: string
}

const DAY_MS = 86_400_000

/**
 * Merged lightweight rows + filtering (q / date window). Date semantics: a
 * conversation hits when it has any turn activity in the window — same
 * accounting as the heatmap.
 */
export function useSessionRows(search: SessionSearch): TrajectoryRow[] {
  const sources = useAtomValue(allSourcesDataAtom)
  const { q, from, to } = search
  return useMemo(() => {
    const items = sources.flatMap((s) =>
      s.status === 'ok'
        ? s.derived.rows.map((row) => ({ row, text: s.derived.paletteText.get(row.id) ?? '' }))
        : [],
    )
    let result = items
    const needle = q?.trim().toLowerCase()
    if (needle) result = result.filter((i) => i.text.toLowerCase().includes(needle))

    if (from || to) {
      const trajectories = new Map<string, Trajectory>()
      for (const s of sources) {
        if (s.status === 'ok') {
          for (const t of s.parsed.trajectories) trajectories.set(t.id, t)
        }
      }

      const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY
      const toMs = to ? Date.parse(to) + DAY_MS - 1 : Number.POSITIVE_INFINITY
      result = result.filter((item) => {
        const t = trajectories.get(item.row.id)
        if (!t) return false
        // any turn activity inside the window counts (heatmap accounting)
        return buildTurns(t).some((turn) => {
          const at = t.nodes.get(turn.inputNodeIds[0])?.at ?? t.startedAt
          return at >= fromMs && at <= toMs
        })
      })
    }

    return result.map((i) => i.row)
  }, [sources, q, from, to])
}
