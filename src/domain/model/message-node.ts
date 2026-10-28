import type { EpochMs, ModelId, NodeId } from './identity'
import { partTextLength } from './part'
import type { Part } from './part'

/** 实测（deepseek 导出全量）：user/assistant 片段从不在同一条消息混排，角色可可靠推断 */
export type Role = 'user' | 'assistant'

/**
 * MessageNode — 消息树节点（真相层）。
 * 扁平存树（Map<NodeId, MessageNode>），不做嵌套对象。
 */
export interface MessageNode {
  readonly id: NodeId
  readonly parentId: NodeId | null
  /** 按 at 升序（不变量 I4）；原 root 哨兵被 adapter 抹除，顶层节点 parentId === null */
  readonly childIds: readonly NodeId[]
  readonly role: Role
  /** 导出里有值但与角色无关（user 消息也带 model），仅元数据 */
  readonly model: ModelId | null
  readonly at: EpochMs
  readonly parts: readonly Part[]
}

export function nodeTextLength(node: MessageNode): number {
  return node.parts.reduce((sum, p) => sum + partTextLength(p), 0)
}
