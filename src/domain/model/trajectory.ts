import type { EpochMs, NodeId, SourceId, TrajectoryId } from './identity'
import type { MessageNode } from './message-node'

/** PersonaProfile — user.json 的领域投影；PII 在 adapter 内就地掩码，明文不进领域层 */
export interface PersonaProfile {
  readonly displayName: string
  /** 已掩码的标识符，如 '166****94@qq.com' */
  readonly identifiers: readonly string[]
}

export interface ParseDiagnostics {
  readonly unknownPartCounts: Readonly<Record<string, number>>
  readonly invariantViolations: readonly string[]
}

/**
 * Trajectory — 聚合根。
 * nodes 为真相层（含分支树），activePath 为默认读路径（每个分支点取末位 child，
 * 实测归纳：导出无 current_node，childIds 时间升序）。
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

/** adapter 的一次产出：领域模型 + 来源级诊断 */
export interface ParsedSource {
  readonly sourceId: SourceId
  readonly label: string
  readonly profile: PersonaProfile | null
  readonly trajectories: readonly Trajectory[]
  readonly diagnostics: ParseDiagnostics
}

/** 用户节点允许的片段种类（附件随提问上传；推理/搜索/工具是助手侧产物） */
export function hasForeignParts(node: MessageNode): boolean {
  if (node.role !== 'user')
    return false
  return node.parts.some(p => p.kind === 'reasoning' || p.kind === 'search' || p.kind === 'tool-call')
}
