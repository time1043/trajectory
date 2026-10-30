import { atom } from 'jotai'

import type { TrajectoryId } from '@/domain/model/identity'
import type { Trajectory } from '@/domain/model/trajectory'

import { createRegexSanitizer } from '@/adapters/sanitize/regex-sanitizer'
import { sourceAdapters } from '@/adapters/sources'
import { detectAdapter, loadTrajectoryBody } from '@/app/ingest'

import { manifestByDirNameAtom } from './data'
import { loadStaticSessionBody, STATIC_DATA_MODE } from './static-data'

const sanitizer = createRegexSanitizer({ sanitizeText: false })

/** Lazy body cache — one session's full trajectory, loaded on demand */
const bodyCache = new Map<TrajectoryId, Trajectory>()

/**
 * Loads one session's body through its adapter, caching the frozen result.
 * The locator is the TrajectoryId ('provider:user:sessionId') resolved against
 * the manifest map to find the owning adapter and its manifest. Static mode
 * (VITE_DATA_MODE=static) skips the manifest map and /@api/file entirely: the
 * raw body comes from /data/sessions/<id>.json and still parses through the
 * owning adapter's loadSession.
 */
export const sessionBodyFamily = atomFamily((id: TrajectoryId) =>
  atom(async (get): Promise<Trajectory | null> => {
    const cached = bodyCache.get(id)
    if (cached) return cached

    if (STATIC_DATA_MODE) {
      const trajectory = await loadStaticSessionBody(id)
      if (trajectory) bodyCache.set(id, trajectory)
      return trajectory
    }

    const [provider, user, ...rest] = id.split(':')
    const sessionId = rest.join(':')
    const suffix = `${provider}/${user}`
    const manifestsByDir = await get(manifestByDirNameAtom)
    const dirName = [...manifestsByDir.keys()].find((d) => d.endsWith(suffix))
    if (!dirName) return null

    const manifest = manifestsByDir.get(dirName)
    if (!manifest) return null
    const adapter = detectAdapter(sourceAdapters, manifest)
    if (!adapter) return null

    const trajectory = await loadTrajectoryBody(adapter, manifest, sessionId, sanitizer)
    if (trajectory) bodyCache.set(id, trajectory)
    return trajectory
  }),
)

import { atomFamily } from '@/lib/atom-family'
