import { atom, useAtomValue, useSetAtom } from 'jotai'

import type { NodeId, TrajectoryId } from '@/domain/model/identity'
import type { Trajectory } from '@/domain/model/trajectory'
import type { VariantRef } from '@/domain/services/turn-builder'
import { switchVariant } from '@/domain/services/turn-builder'
import type { DocumentView } from '@/domain/services/document-view'
import { buildDocumentView } from '@/domain/services/document-view'
import { allTrajectoriesAtom } from './data'
import { atomFamily } from '@/lib/atom-family'

/** 用户切过的变体路径覆盖（只存显式切换过的会话；回到默认态时移除条目） */
export const variantPathsAtom = atom(new Map<TrajectoryId, readonly NodeId[]>())

export const setVariantPathAtom = atom(
  null,
  (get, set, payload: { trajId: TrajectoryId, path: readonly NodeId[], isDefault: boolean }) => {
    const next = new Map(get(variantPathsAtom))
    if (payload.isDefault)
      next.delete(payload.trajId)
    else
      next.set(payload.trajId, payload.path)
    set(variantPathsAtom, next)
  },
)

export const trajectoryByIdFamily = atomFamily((id: TrajectoryId) =>
  atom(async (get): Promise<Trajectory | null> => {
    const trajectories = await get(allTrajectoriesAtom)
    return trajectories.find(t => t.id === id) ?? null
  }))

/** 详情页文档流读模型：变体覆盖路径参与计算，切换变体 = 写 variantPathsAtom */
export const documentViewFamily = atomFamily((id: TrajectoryId) =>
  atom(async (get): Promise<DocumentView | null> => {
    const trajectory = await get(trajectoryByIdFamily(id))
    if (!trajectory)
      return null
    const override = get(variantPathsAtom).get(id)
    return buildDocumentView(trajectory, override)
  }))

/** 变体切换 hook：纯函数计算新路径后写入 atom；UI 层不触碰节点遍历 */
export function useVariantSwitcher(trajId: TrajectoryId) {
  const trajectory = useAtomValue(trajectoryByIdFamily(trajId))
  const setVariantPath = useSetAtom(setVariantPathAtom)
  const variantPaths = useAtomValue(variantPathsAtom)
  return (variant: VariantRef) => {
    if (!trajectory)
      return
    const current = variantPaths.get(trajId) ?? trajectory.activePath
    const next = switchVariant(trajectory, current, variant)
    setVariantPath({ trajId, path: next, isDefault: next.join(',') === trajectory.activePath.join(',') })
  }
}
