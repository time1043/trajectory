import { atom, useAtomValue, useSetAtom } from 'jotai'

import type { NodeId, TrajectoryId } from '@/domain/model/identity'
import type { DocumentView } from '@/domain/services/document-view'
import type { VariantRef } from '@/domain/services/turn-builder'

import { buildDocumentView } from '@/domain/services/document-view'
import { switchVariant } from '@/domain/services/turn-builder'

import { sessionBodyFamily } from './body'
export { sessionBodyFamily }
import { atomFamily } from '@/lib/atom-family'

/** Variant paths the user explicitly switched to (only overridden conversations are stored) */
export const variantPathsAtom = atom(new Map<TrajectoryId, readonly NodeId[]>())

export const setVariantPathAtom = atom(
  null,
  (get, set, payload: { trajId: TrajectoryId; path: readonly NodeId[]; isDefault: boolean }) => {
    const next = new Map(get(variantPathsAtom))
    if (payload.isDefault) next.delete(payload.trajId)
    else next.set(payload.trajId, payload.path)
    set(variantPathsAtom, next)
  },
)

/** Reading model for the detail page; variant overrides participate, switching = write variantPathsAtom */
export const documentViewFamily = atomFamily((id: TrajectoryId) =>
  atom(async (get): Promise<DocumentView | null> => {
    const trajectory = await get(sessionBodyFamily(id))
    if (!trajectory) return null
    const override = get(variantPathsAtom).get(id)
    return buildDocumentView(trajectory, override)
  }),
)

/** Pure variant switch: compute the new path, store it; the UI never traverses nodes itself */
export function useVariantSwitcher(trajId: TrajectoryId) {
  const trajectory = useAtomValue(sessionBodyFamily(trajId))
  const setVariantPath = useSetAtom(setVariantPathAtom)
  const variantPaths = useAtomValue(variantPathsAtom)
  return (variant: VariantRef) => {
    if (!trajectory) return
    const current = variantPaths.get(trajId) ?? trajectory.activePath
    const next = switchVariant(trajectory, current, variant)
    setVariantPath({
      trajId,
      path: next,
      isDefault: next.join(',') === trajectory.activePath.join(','),
    })
  }
}
