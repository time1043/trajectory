import type { EpochMs, SourceId, TrajectoryId } from '@/domain/model/identity'
import type { SourceIndex } from '@/domain/ports/source-adapter'

import { topicDictionary } from '@/adapters/topics/dictionary'
import { OTHER_TOPIC, assignTopic } from '@/domain/services/topics'

/** topic id -> display label; unmatched ('other') returns undefined and the UI hides it */
export function topicLabel(id: string): string | undefined {
  if (id === OTHER_TOPIC) return undefined
  return topicDictionary.find((def) => def.id === id)?.label
}

/**
 * Lightweight rows for lists and panels — derived from session summaries at
 * index time. Rendering 520 rows must never touch session bodies.
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
  /** Turn start times — the date-window filter runs on these, no bodies needed */
  readonly turnStarts: readonly number[]
  /** Matched topic id; 'other' means unmatched (hidden in UI) */
  readonly primaryTopic: string
}

export interface SourceDerived {
  readonly rows: readonly TrajectoryRow[]
  /** Palette search text: title + first user prompt (upstream of the sanitizer boundary) */
  readonly paletteText: ReadonlyMap<TrajectoryId, string>
}

export function deriveSource(index: Omit<SourceIndex, 'diagnostics'>): SourceDerived {
  const rows: TrajectoryRow[] = []
  const paletteText = new Map<TrajectoryId, string>()

  for (const session of index.sessions) {
    const firstText = session.firstPrompt
    paletteText.set(session.id, `${session.title}\n${firstText}`)
    rows.push({
      id: session.id,
      sourceId: index.sourceId,
      provider: index.provider,
      user: index.user,
      sessionId: session.sessionId,
      title: session.title,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnStarts.length,
      turnStarts: session.turnStarts,
      primaryTopic: assignTopic(topicDictionary, session.title, firstText),
    })
  }

  rows.sort((a, b) => b.updatedAt - a.updatedAt)
  return { rows, paletteText }
}
