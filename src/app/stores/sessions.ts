import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

import type { TrajectoryRow } from '@/app/derive'
import type { Trajectory } from '@/domain/model/trajectory'
import { buildTurns } from '@/domain/services/turn-builder'
import { allSourcesDataAtom } from './data'

/** /sessions 路由的 search params 形状（真源在 URL，jotai 不重复持有） */
export interface SessionSearch {
  q?: string
  from?: string
  to?: string
}

const DAY_MS = 86_400_000

/**
 * 合并轻量行 + 三维过滤（q / provider / 日期窗口）。
 * 日期口径：会话在窗口内有任意 Turn 活动即命中——与热力图按 Turn 计数一致。
 */
export function useSessionRows(search: SessionSearch): TrajectoryRow[] {
  const sources = useAtomValue(allSourcesDataAtom)
  const { q, from, to } = search
  return useMemo(() => {
    const items = sources.flatMap(s =>
      s.status === 'ok'
        ? s.derived.rows.map(row => ({ row, text: s.derived.paletteText.get(row.id) ?? '' }))
        : [],
    )
    const trajectories = new Map<string, Trajectory>()
    for (const s of sources) {
      if (s.status === 'ok') {
        for (const t of s.parsed.trajectories)
          trajectories.set(t.id, t)
      }
    }

    let result = items
    const needle = q?.trim().toLowerCase()
    if (needle)
      result = result.filter(i => i.text.toLowerCase().includes(needle))

    if (from || to) {
      const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY
      const toMs = to ? Date.parse(to) + DAY_MS - 1 : Number.POSITIVE_INFINITY
      result = result.filter((item) => {
        const t = trajectories.get(item.row.id)
        if (!t)
          return false
        return buildTurns(t).some((turn) => {
          const at = t.nodes.get(turn.inputNodeIds[0])?.at ?? t.startedAt
          return at >= fromMs && at <= toMs
        })
      })
    }

    return result.map(i => i.row)
  }, [sources, q, from, to])
}
