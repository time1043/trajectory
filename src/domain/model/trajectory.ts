import type { EpochMs, NodeId, SourceId, TrajectoryId } from './identity'
import type { MessageNode } from './message-node'

/** Projection of the export's user record; PII is masked inside the adapter, plaintext never enters the domain */
export interface PersonaProfile {
  readonly displayName: string
  readonly identifiers: readonly string[]
}

export interface ParseDiagnostics {
  readonly unknownPartCounts: Readonly<Record<string, number>>
  readonly invariantViolations: readonly string[]
}

/**
 * Aggregate root. `nodes` is the truth layer (full branch tree); `activePath`
 * is the default read path — last child at every fork (empirical: exports
 * carry no current_node and childIds come out time-ascending).
 */
export interface Trajectory {
  readonly id: TrajectoryId
  readonly sourceId: SourceId
  readonly title: string
  readonly startedAt: EpochMs
  readonly updatedAt: EpochMs
  readonly nodes: ReadonlyMap<NodeId, MessageNode>
  readonly activePath: readonly NodeId[]
}

/** One adapter output: domain model plus source-level diagnostics */
export interface ParsedSource {
  readonly sourceId: SourceId
  readonly label: string
  readonly profile: PersonaProfile | null
  readonly trajectories: readonly Trajectory[]
  readonly diagnostics: ParseDiagnostics
}

/** Kinds allowed in a user node (attachments ride the prompt; reasoning/search/tools are assistant-side) */
export function hasForeignParts(node: MessageNode): boolean {
  if (node.role !== 'user') return false
  return node.parts.some(
    (p) => p.kind === 'reasoning' || p.kind === 'search' || p.kind === 'tool-call',
  )
}
