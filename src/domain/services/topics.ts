/**
 * Topic — 派生读模型的类型与纯匹配函数。
 * 本期口径：预置关键词字典（中英 patterns），确定、可复述、<5ms@520。
 * 端口留给未来 LLM/embedding 实现；字典本体是"策略"，放 adapters/topics/。
 */
export interface TopicDef {
  readonly id: string
  readonly label: string
  readonly patterns: readonly string[]
}

export const OTHER_TOPIC = 'other'

/** 返回命中 TopicDef 的 id；多条命中取 patterns 命中数最多者；无命中 → other */
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
