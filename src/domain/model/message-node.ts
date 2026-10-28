import type { EpochMs, ModelId, NodeId } from './identity'
import type { Part } from './part'

/** Data audit: user/assistant fragments never mix within one message — role inference is reliable */
export type Role = 'user' | 'assistant'

/** Tree node (truth layer), stored flat in Map<NodeId, MessageNode> */
export interface MessageNode {
  readonly id: NodeId
  readonly parentId: NodeId | null
  /** Ascending by `at` (I4); the root sentinel is erased, top-level nodes have parentId === null */
  readonly childIds: readonly NodeId[]
  readonly role: Role
  /** Present in exports even on user messages — unrelated to role, metadata only */
  readonly model: ModelId | null
  readonly at: EpochMs
  readonly parts: readonly Part[]
}
