import type { NodeId } from './identity'
import type { MessageNode } from './message-node'
import type { Trajectory } from './trajectory'
import { hasForeignParts } from './trajectory'

/**
 * 领域不变量。adapter 产出后由 ingest 管道调用；
 * 违例不 throw（导出格式不可控，crash 一个坏会话不如跳过并记录），
 * 收集为字符串进 ParseDiagnostics.invariantViolations。
 */
export function checkInvariants(t: Trajectory): readonly string[] {
  const violations: string[] = []

  // I1 单棵连通有穷树、无环：从顶层出发可达节点数 === nodes.size
  const topLevels = [...t.nodes.values()].filter(n => n.parentId === null)
  if (topLevels.length === 0)
    violations.push(`${t.id}: no top-level node`)
  const reachable = new Set<NodeId>()
  const stack = [...topLevels.map(n => n.id)]
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id)) {
      violations.push(`${t.id}: cycle or shared child at ${id}`)
      break
    }
    reachable.add(id)
    const node = t.nodes.get(id)
    if (!node) {
      violations.push(`${t.id}: dangling reference to ${id}`)
      continue
    }
    stack.push(...node.childIds)
  }
  if (reachable.size !== t.nodes.size)
    violations.push(`${t.id}: ${t.nodes.size - reachable.size} unreachable node(s)`)

  // I3 角色与片段种类一致
  for (const node of t.nodes.values()) {
    if (hasForeignParts(node))
      violations.push(`${t.id}: user node ${node.id} carries assistant-side parts`)
  }

  // I4 childIds 按 at 升序
  for (const node of t.nodes.values()) {
    for (let i = 1; i < node.childIds.length; i++) {
      const prev = t.nodes.get(node.childIds[i - 1])
      const next = t.nodes.get(node.childIds[i])
      if (prev && next && prev.at > next.at)
        violations.push(`${t.id}: childIds not ascending at ${node.id}`)
    }
  }

  // I5 时间可解析且 startedAt <= updatedAt
  if (!(t.startedAt <= t.updatedAt))
    violations.push(`${t.id}: startedAt > updatedAt`)

  // I2 activePath 从某顶层节点连续可达且全部存在
  if (t.activePath.length) {
    const first = t.nodes.get(t.activePath[0])
    if (!first || first.parentId !== null)
      violations.push(`${t.id}: activePath does not start at a top-level node`)
    for (let i = 1; i < t.activePath.length; i++) {
      const node = t.nodes.get(t.activePath[i])
      if (!node || node.parentId !== t.activePath[i - 1])
        violations.push(`${t.id}: activePath broken at index ${i}`)
    }
  }

  return violations
}

/** activePath：从每个分支点取末位 child（root 的多个顶层子节点同样取末位） */
export function defaultActivePath(nodes: ReadonlyMap<NodeId, MessageNode>): readonly NodeId[] {
  const roots = [...nodes.values()]
    .filter(n => n.parentId === null)
    .sort((a, b) => a.at - b.at)
  if (!roots.length)
    return []
  const path: NodeId[] = []
  let current = roots[roots.length - 1]
  const seen = new Set<NodeId>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current.id)
    const children = current.childIds
      .map(id => nodes.get(id))
      .filter((n): n is MessageNode => !!n)
      .sort((a, b) => a.at - b.at)
    current = children[children.length - 1]
  }
  return path
}
