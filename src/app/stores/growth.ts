import { atom } from 'jotai'

import type { GrowthOverview } from '@/domain/services/growth-analytics'

import { computeGrowthOverview } from '@/domain/services/growth-analytics'

import { allSessionsAtom } from './data'

/** Dashboard stats: activity, streaks, hour histogram — one pass over all sources */
export const growthOverviewAtom = atom(async (get): Promise<GrowthOverview> => {
  const sessions = await get(allSessionsAtom)
  return computeGrowthOverview(sessions)
})
