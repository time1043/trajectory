import type { EpochMs, NodeId } from '@/domain/model/identity'
import type { MessageNode, Role } from '@/domain/model/message-node'
import type { Part } from '@/domain/model/part'
import type { Trajectory } from '@/domain/model/trajectory'

import { defaultActivePath } from '@/domain/services/turn-builder'

/**
 * Trajectory fixtures for tests. Nodes are declared as a flat list with
 * explicit parents; child order follows declaration order (which must be
 * time-ascending, mirroring the adapters' normalization).
 */
export interface NodeSpec {
  id: string
  role: Role
  at: number
  parent: NodeId | null
  parts?: Part[]
  model?: string | null
}

const MINUTE = 60_000

/** compact time builder: minutes from a fixed epoch */
export function at(minutes: number): EpochMs {
  return 1_700_000_000_000 + minutes * MINUTE
}

export function text(text: string): Part {
  return { kind: 'text', text }
}

export function reasoning(text: string): Part {
  return { kind: 'reasoning', text }
}

export function search(results: Array<{ url: string; title: string }>): Part {
  return { kind: 'search', results }
}

export function tool(tool: string, output?: string): Part {
  return { kind: 'tool-call', tool, payload: output ? { output } : undefined }
}

export function makeTrajectory(specs: readonly NodeSpec[]): Trajectory {
  const nodes = new Map<NodeId, MessageNode>()
  for (const spec of specs) {
    nodes.set(spec.id, {
      id: spec.id,
      parentId: spec.parent,
      childIds: specs.filter((s) => s.parent === spec.id).map((s) => s.id),
      role: spec.role,
      model: spec.model ?? null,
      at: spec.at,
      parts: spec.parts ?? [],
    })
  }
  return {
    id: 'test:t1',
    sourceId: 'test',
    title: 'fixture',
    startedAt: specs.length ? Math.min(...specs.map((s) => s.at)) : 0,
    updatedAt: specs.length ? Math.max(...specs.map((s) => s.at)) : 0,
    nodes,
    activePath: defaultActivePath(nodes),
  }
}
