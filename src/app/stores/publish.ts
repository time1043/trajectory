import { atom } from 'jotai'

import { trajectoryIdFromParts } from '@/domain/model/identity'

/**
 * Publish state lives IN the public dataset — a session is published iff its
 * data exists under data-public/. The dev server exposes the list and the
 * mutation; this store is a thin cache with its own invalidation.
 */
const publishedVersionAtom = atom(0)

export const publishedIdsAtom = atom(async (get) => {
  get(publishedVersionAtom)
  const res = await fetch('/@api/published')
  if (!res.ok) throw new Error(`[trajectory] /@api/published: ${res.status}`)
  const list = (await res.json()) as { provider: string; user: string; sessionIds: string[] }[]
  const ids = new Set<string>()
  for (const entry of list) {
    for (const sessionId of entry.sessionIds) {
      ids.add(trajectoryIdFromParts(entry.provider, entry.user, sessionId))
    }
  }
  return ids
})

/** Toggle publication for one session; the response refreshes the cached set */
export const setPublishedAtom = atom(
  null,
  async (
    _get,
    set,
    payload: { provider: string; user: string; sessionId: string; publish: boolean },
  ) => {
    const res = await fetch('/@api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`[trajectory] publish: ${res.status}`)
    // refetch through the version bump — the endpoint is cheap
    set(publishedVersionAtom, (v) => v + 1)
  },
)
