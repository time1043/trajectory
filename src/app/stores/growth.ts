import { atom } from 'jotai'

import { computeGrowthOverview } from '@/domain/services/growth-analytics'
import type { GrowthOverview } from '@/domain/services/growth-analytics'
import { allTrajectoriesAtom } from './data'

/** Dashboard stats: activity, streaks, hour histogram — one pass over all sources */
export const growthOverviewAtom = atom(async (get): Promise<GrowthOverview> => {
  const trajectories = await get(allTrajectoriesAtom)
  return computeGrowthOverview(trajectories)
})
