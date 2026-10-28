import { atom } from 'jotai'

import type { TrajectoryRow } from '@/app/derive'
import { computeGrowthOverview } from '@/domain/services/growth-analytics'
import type { GrowthOverview } from '@/domain/services/growth-analytics'
import { allSourcesDataAtom, allTrajectoriesAtom } from './data'

/** Dashboard 统计：activity/streak/hour 分布，一次算完（520 会话 <50ms） */
export const growthOverviewAtom = atom(async (get): Promise<GrowthOverview> => {
  const trajectories = await get(allTrajectoriesAtom)
  return computeGrowthOverview(trajectories)
})

export interface PaletteItem {
  readonly row: TrajectoryRow
  /** title + 首条用户消息（检索文本） */
  readonly text: string
}

/** ⌘K 索引：惰性构建（首次打开才求值），jotai 缓存即缓存策略；不引入 fuse.js */
export const paletteIndexAtom = atom(async (get): Promise<readonly PaletteItem[]> => {
  const sources = await get(allSourcesDataAtom)
  return sources
    .filter(s => s.status === 'ok')
    .flatMap(s => s.derived.rows.map(row => ({ row, text: s.derived.paletteText.get(row.id) ?? row.title })))
})

/** 朴素打分：title 命中权重高于正文；520 条全扫 <1ms */
export function scorePaletteItem(item: PaletteItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q)
    return 1
  const title = item.row.title.toLowerCase()
  if (title.includes(q))
    return 100
  let score = 0
  let index = title.indexOf(q[0])
  // subsequence 命中 title
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
  if (score === 0 && item.text.toLowerCase().includes(q))
    score = 10
  return score
}
