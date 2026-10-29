import { describe, expect, it } from 'vitest'

import type { TopicDef } from './topics'

import { OTHER_TOPIC, assignTopic } from './topics'

const defs: readonly TopicDef[] = [
  { id: 'coding', label: 'Coding', patterns: ['react', '报错'] },
  { id: 'translate', label: 'Translation', patterns: ['翻译'] },
]

describe('assignTopic', () => {
  it('returns the id with the most pattern hits', () => {
    expect(assignTopic(defs, 'react 组件报错了', '')).toBe('coding')
  })

  it('is case-insensitive', () => {
    expect(assignTopic(defs, 'REACT', '')).toBe('coding')
  })

  it('combines title and the first 200 chars of the prompt', () => {
    expect(assignTopic(defs, '没有关键词', `${'x'.repeat(150)}请帮我翻译这段`)).toBe('translate')
  })

  it('falls back to other when nothing matches', () => {
    expect(assignTopic(defs, '今天天气不错', ' indeed')).toBe(OTHER_TOPIC)
  })
})
