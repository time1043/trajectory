import type { EpochMs, SourceId, TrajectoryId } from '@/domain/model/identity'
import type { ParsedSource, Trajectory } from '@/domain/model/trajectory'
import { buildTurns } from '@/domain/services/turn-builder'
import { OTHER_TOPIC, assignTopic } from '@/domain/services/topics'
import { topicDictionary } from '@/adapters/topics/dictionary'

/** topic id → 中文标签；未命中（other）返回 undefined（UI 不渲染） */
export function topicLabel(id: string): string | undefined {
  if (id === OTHER_TOPIC)
    return undefined
  return topicDictionary.find(def => def.id === id)?.label
}

/**
 * 列表/面板消费的轻量行。渲染 520 行时绝不触碰 nodes Map；
 * 字段全部在 ingest 期预计算。
 */
export interface TrajectoryRow {
  readonly id: TrajectoryId
  readonly sourceId: SourceId
  readonly title: string
  readonly startedAt: EpochMs
  readonly updatedAt: EpochMs
  /** 活跃路径上的 Turn 数 */
  readonly turnCount: number
  /** 活跃路径上含 message 的节点数（"消息数"口径） */
  readonly msgCount: number
  /** 命中的主题 id；'other' 表示未命中（UI 不展示） */
  readonly primaryTopic: string
}

export interface SourceDerived {
  readonly rows: readonly TrajectoryRow[]
  /** ⌘K 检索用：title + 首条用户消息（上游已过 sanitize 边界） */
  readonly paletteText: ReadonlyMap<TrajectoryId, string>
}

/** 活跃路径上第一个 user 节点的首个 text 片段 */
export function firstUserText(t: Trajectory): string {
  for (const nodeId of t.activePath) {
    const node = t.nodes.get(nodeId)
    if (node?.role === 'user') {
      const text = node.parts.find(p => p.kind === 'text')
      if (text && text.kind === 'text')
        return text.text
    }
  }
  return ''
}

export function deriveSource(parsed: ParsedSource): SourceDerived {
  const rows: TrajectoryRow[] = []
  const paletteText = new Map<TrajectoryId, string>()

  for (const t of parsed.trajectories) {
    const firstText = firstUserText(t)
    const turnCount = buildTurns(t).length
    const msgCount = t.activePath.filter(id => t.nodes.has(id)).length
    paletteText.set(t.id, `${t.title}\n${firstText}`)
    rows.push({
      id: t.id,
      sourceId: t.sourceId,
      title: t.title,
      startedAt: t.startedAt,
      updatedAt: t.updatedAt,
      turnCount,
      msgCount,
      primaryTopic: assignTopic(topicDictionary, t.title, firstText),
    })
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt)
  return { rows, paletteText }
}
