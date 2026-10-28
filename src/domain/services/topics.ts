/**
 * Topic read-model types plus the pure matcher. Current approach: a curated
 * keyword dictionary — deterministic, explainable, <5ms @ 520 conversations.
 * The port for a future LLM/embedding implementation stays open; the
 * dictionary itself (policy) lives in adapters/topics/.
 */
export interface TopicDef {
  readonly id: string
  readonly label: string
  readonly patterns: readonly string[]
}

export const OTHER_TOPIC = 'other'

/** Id of the TopicDef with the most pattern hits; 'other' when none match */
export function assignTopic(
  defs: readonly TopicDef[],
  title: string,
  firstUserText: string,
): string {
  const haystack = `${title}\n${firstUserText.slice(0, 200)}`
  let best: { id: string; hits: number } | null = null
  for (const def of defs) {
    let hits = 0
    for (const pattern of def.patterns) {
      if (haystack.toLowerCase().includes(pattern.toLowerCase()))
        hits++
    }
    if (hits > 0 && (!best || hits > best.hits))
      best = { id: def.id, hits }
  }
  return best?.id ?? OTHER_TOPIC
}
