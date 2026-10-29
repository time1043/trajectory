import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import type { TrajectoryId } from '@/domain/model/identity'

/**
 * User-created tags per session — accumulated during usage, persisted locally
 * (localStorage). The future share/redaction feature can lift these into a
 * sidecar file via the dev-server plugin without changing the shape.
 */
export const sessionTagsAtom = atomWithStorage<Record<TrajectoryId, string[]>>(
  'trajectory.sessionTags',
  {},
)

/** tag -> number of sessions carrying it */
export const allTagCountsAtom = atom((get) => {
  const tagsBySession = get(sessionTagsAtom)
  const counts = new Map<string, number>()
  for (const tags of Object.values(tagsBySession)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
})
