/** SourceId — 外部系统的标识，如 'deepseek'、'chatgpt'、'claude' */
export type SourceId = string

/**
 * TrajectoryId — 领域内全局唯一：`${sourceId}:${原始id}`。
 * 由 adapter 在构造时 namespaced（见 adapters/sources/deepseek），
 * 多来源合并索引直接以它为主键。
 */
export type TrajectoryId = string

/** 树节点 id，来源内唯一（跨来源不保证，因此对外暴露时永远搭配 TrajectoryId） */
export type NodeId = string

/** 模型名不枚举——未来来源的模型名不可预知，只做元数据展示 */
export type ModelId = string

/** UTC 纪元毫秒。导出中的时区偏移在 adapter 折算；"按天分桶"是展示层关注点 */
export type EpochMs = number

export function trajectoryId(source: SourceId, rawId: string): TrajectoryId {
  return `${source}:${rawId}`
}
