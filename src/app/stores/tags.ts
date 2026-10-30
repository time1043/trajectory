import { atom } from 'jotai'

import type { TrajectoryId } from '@/domain/model/identity'

import { STATIC_DATA_MODE } from '@/app/stores/static-data'

export type SessionTagsMap = Record<TrajectoryId, string[]>

export type SessionTagsUpdate =
  | SessionTagsMap
  | { trajectoryId: TrajectoryId; tags: string[] }
  | ((prev: SessionTagsMap) => SessionTagsMap)

async function fetchTags(): Promise<SessionTagsMap> {
  if (STATIC_DATA_MODE) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/tags.json`)
      if (res.ok) return (await res.json()) as SessionTagsMap
    } catch {
      // ignore in static mode
    }
    return {}
  }

  try {
    const res = await fetch('/@api/tags')
    if (res.ok) {
      const serverTags = (await res.json()) as SessionTagsMap
      // Legacy localStorage migration: migrate to data/tags.json in dev mode once
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        try {
          const legacyRaw = localStorage.getItem('trajectory.sessionTags')
          if (legacyRaw) {
            const legacyTags = JSON.parse(legacyRaw) as SessionTagsMap
            if (
              legacyTags &&
              typeof legacyTags === 'object' &&
              Object.keys(legacyTags).length > 0
            ) {
              let hasNew = false
              const merged = { ...serverTags }
              for (const [id, tags] of Object.entries(legacyTags)) {
                if (!merged[id] || merged[id].length === 0) {
                  merged[id] = tags
                  hasNew = true
                }
              }
              if (hasNew) {
                await fetch('/@api/tags', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ allTags: merged }),
                })
                localStorage.removeItem('trajectory.sessionTags')
                return merged
              }
              localStorage.removeItem('trajectory.sessionTags')
            }
          }
        } catch (e) {
          console.warn('[trajectory] failed to migrate legacy localStorage tags', e)
        }
      }
      return serverTags
    }
  } catch (e) {
    console.warn('[trajectory] failed to fetch tags:', e)
  }
  return {}
}

const tagsDataAtom = atom<SessionTagsMap | null>(null)

const loadTagsAtom = atom(async () => {
  return await fetchTags()
})

/**
 * User-created tags per session — persisted under data/tags.json (or
 * data-public/tags.json in preview/public mode).
 */
export const sessionTagsAtom = atom(
  async (get): Promise<SessionTagsMap> => {
    const cached = get(tagsDataAtom)
    if (cached !== null) return cached
    return await get(loadTagsAtom)
  },
  async (get, set, update: SessionTagsUpdate) => {
    const current = await get(sessionTagsAtom)
    let next: SessionTagsMap
    let payload: { trajectoryId?: string; tags?: string[]; allTags?: Record<string, string[]> }

    if (typeof update === 'function') {
      next = update(current)
      payload = { allTags: next }
    } else if (
      'trajectoryId' in update &&
      typeof update.trajectoryId === 'string' &&
      Array.isArray(update.tags)
    ) {
      const tid = update.trajectoryId
      const tags = update.tags
      next = { ...current }
      if (tags.length > 0) {
        next[tid] = tags
      } else {
        delete next[tid]
      }
      payload = { trajectoryId: tid, tags }
    } else {
      next = update as SessionTagsMap
      const currentKeys = Object.keys(current)
      const nextKeys = Object.keys(next)
      let touched: string | null = null
      let diffCount = 0
      for (const k of new Set([...currentKeys, ...nextKeys])) {
        const cVal = current[k]
        const nVal = next[k]
        if (JSON.stringify(cVal) !== JSON.stringify(nVal)) {
          touched = k
          diffCount++
          if (diffCount > 1) break
        }
      }
      if (diffCount === 1 && touched) {
        payload = { trajectoryId: touched, tags: next[touched] ?? [] }
      } else {
        payload = { allTags: next }
      }
    }

    // Optimistically update in memory
    set(tagsDataAtom, next)

    if (!import.meta.env.DEV) return

    try {
      const res = await fetch('/@api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        console.error(`[trajectory] failed to save tags: ${res.status}`)
        set(tagsDataAtom, current)
      } else {
        const saved = (await res.json()) as SessionTagsMap
        set(tagsDataAtom, saved)
      }
    } catch (err) {
      console.error('[trajectory] failed to save tags:', err)
      set(tagsDataAtom, current)
    }
  },
)

/** tag -> number of sessions carrying it */
export const allTagCountsAtom = atom(async (get) => {
  const tagsBySession = await get(sessionTagsAtom)
  const counts = new Map<string, number>()
  for (const tags of Object.values(tagsBySession)) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
})
