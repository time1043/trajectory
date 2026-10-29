import type { EpochMs, SourceId, TrajectoryId } from '@/domain/model/identity'
import type { ParsedSource, Trajectory } from '@/domain/model/trajectory'

import { topicDictionary } from '@/adapters/topics/dictionary'
import { OTHER_TOPIC, assignTopic } from '@/domain/services/topics'
import { buildTurns } from '@/domain/services/turn-builder'

/** topic id -> display label; unmatched ('other') returns undefined and the UI hides it */
export function topicLabel(id: string): string | undefined {
  if (id === OTHER_TOPIC) return undefined
  return topicDictionary.find((def) => def.id === id)?.label
}

/**
 * Lightweight rows for lists and panels — rendering 520 rows must never touch
 * the node maps, so everything here is precomputed at ingest time.
 */
export interface TrajectoryRow {
  readonly id: TrajectoryId
  readonly sourceId: SourceId
  readonly provider: string
  readonly user: string
  readonly sessionId: string
  readonly title: string
  readonly startedAt: EpochMs
  readonly updatedAt: EpochMs
  readonly turnCount: number
  /** Matched topic id; 'other' means unmatched (hidden in UI) */
  readonly primaryTopic: string
}

export interface SourceDerived {
  readonly rows: readonly TrajectoryRow[]
  /** Palette search text: title + first user prompt (upstream of the sanitizer boundary) */
  readonly paletteText: ReadonlyMap<TrajectoryId, string>
}

/** First text fragment of the first user node on the active path */
export function firstUserText(t: Trajectory): string {
  for (const nodeId of t.activePath) {
    const node = t.nodes.get(nodeId)
    if (node?.role === 'user') {
      const text = node.parts.find((p) => p.kind === 'text')
      if (text && text.kind === 'text') return text.text
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
    paletteText.set(t.id, `${t.title}\n${firstText}`)
    rows.push({
      id: t.id,
      sourceId: t.sourceId,
      provider: t.provider,
      user: t.user,
      sessionId: t.sessionId,
      title: t.title,
      startedAt: t.startedAt,
      updatedAt: t.updatedAt,
      turnCount,
      primaryTopic: assignTopic(topicDictionary, t.title, firstText),
    })
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt)
  return { rows, paletteText }
}
