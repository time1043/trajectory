/** External system identifier, e.g. 'deepseek', 'chatgpt', 'claude' */
export type SourceId = string

/**
 * Globally unique: `${sourceId}:${rawId}`. Namespaced by the adapter at
 * construction so merged multi-source indexing can key on it directly.
 */
export type TrajectoryId = string

/** Tree node id, unique within a source — expose only alongside a TrajectoryId */
export type NodeId = string

/** Model names are never enumerated — unpredictable across sources, metadata only */
export type ModelId = string

/** UTC epoch ms. Export timezone offsets fold here; day bucketing is a display concern */
export type EpochMs = number

export function trajectoryId(source: SourceId, rawId: string): TrajectoryId {
  return `${source}:${rawId}`
}
