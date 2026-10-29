import type { NodeId } from './identity'
import type { Trajectory } from './trajectory'

import { hasForeignParts } from './trajectory'

/**
 * Domain invariants, checked by the ingest pipeline after adapter output.
 * Violations are collected, never thrown — exports are uncontrollable, and
 * skipping one bad conversation beats crashing the whole source.
 */
export function checkInvariants(t: Trajectory): readonly string[] {
  const violations: string[] = []

  // I1 single connected acyclic tree: every node reachable from a top-level one
  const topLevels = [...t.nodes.values()].filter((n) => n.parentId === null)
  if (topLevels.length === 0) violations.push(`${t.id}: no top-level node`)
  const reachable = new Set<NodeId>()
  const stack = [...topLevels.map((n) => n.id)]
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

  // I3 role / fragment-kind consistency
  for (const node of t.nodes.values()) {
    if (hasForeignParts(node))
      violations.push(`${t.id}: user node ${node.id} carries assistant-side parts`)
  }

  // I4 childIds ascending by at
  for (const node of t.nodes.values()) {
    for (let i = 1; i < node.childIds.length; i++) {
      const prev = t.nodes.get(node.childIds[i - 1])
      const next = t.nodes.get(node.childIds[i])
      if (prev && next && prev.at > next.at)
        violations.push(`${t.id}: childIds not ascending at ${node.id}`)
    }
  }

  // I5 startedAt <= updatedAt
  if (!(t.startedAt <= t.updatedAt)) violations.push(`${t.id}: startedAt > updatedAt`)

  // I6 activePath starts at a top-level node and stays parent-connected
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
