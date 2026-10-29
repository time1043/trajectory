import { describe, expect, it } from 'vitest'

import { buildTurns, switchVariant } from '@/domain/services/turn-builder'

import { at, makeTrajectory, reasoning, text, tool } from '../../fixtures'

describe('buildTurns', () => {
  it('linearizes user/assistant pairs into turns', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q1')] },
      { id: 'a1', role: 'assistant', at: at(1), parent: 'u1', parts: [text('r1')] },
      { id: 'u2', role: 'user', at: at(10), parent: 'a1', parts: [text('q2')] },
      { id: 'a2', role: 'assistant', at: at(11), parent: 'u2', parts: [text('r2')] },
    ])
    const turns = buildTurns(t)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ index: 0, inputNodeIds: ['u1'], outputNodeIds: ['a1'] })
    expect(turns[0]?.totalLatencyMs).toBe(at(1) - at(0))
    expect(turns[1]).toMatchObject({ index: 1, inputNodeIds: ['u2'], outputNodeIds: ['a2'] })
  })

  it('merges consecutive user nodes (question rewrites) into one turn', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('draft')] },
      { id: 'u2', role: 'user', at: at(1), parent: 'u1', parts: [text('rewritten')] },
      { id: 'a1', role: 'assistant', at: at(2), parent: 'u2', parts: [text('answer')] },
    ])
    const turns = buildTurns(t)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.inputNodeIds).toEqual(['u1', 'u2'])
    expect(turns[0]?.outputNodeIds).toEqual(['a1'])
    expect(turns[0]?.totalLatencyMs).toBe(at(2) - at(0)) // measured from the first input
  })

  it('keeps user turns without replies (empty outputs, null latency)', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
    ])
    const turns = buildTurns(t)
    expect(turns).toHaveLength(1)
    expect(turns[0]?.outputNodeIds).toEqual([])
    expect(turns[0]?.totalLatencyMs).toBeNull()
  })

  it('collects sibling subtrees at forks as variants, top-level included', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('opening v1')] },
      { id: 'u2', role: 'user', at: at(1), parent: null, parts: [text('opening v2')] },
      { id: 'a1', role: 'assistant', at: at(2), parent: 'u2', parts: [text('v1')] },
      { id: 'a2', role: 'assistant', at: at(3), parent: 'u2', parts: [text('v2')] },
    ])
    const turns = buildTurns(t)
    expect(turns).toHaveLength(1)
    // u2's virtual-root siblings plus a2's regenerate sibling
    expect(turns[0]?.variants).toEqual([
      { nodeId: 'u1', siblingOf: 'u2' },
      { nodeId: 'a1', siblingOf: 'a2' },
    ])
  })

  it('estimates character volume for lazy placeholders', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('0123456789'.repeat(10))] },
      {
        id: 'a1',
        role: 'assistant',
        at: at(1),
        parent: 'u1',
        parts: [reasoning('x'.repeat(500)), tool('Bash', 'y'.repeat(300))],
      },
    ])
    const turns = buildTurns(t)
    // text + reasoning count; tool outputs stay collapsed so they do not
    expect(turns[0]?.approxChars).toBe(600)
  })
})

describe('switchVariant', () => {
  it('swaps mid-path while keeping the prefix node-identical', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
      { id: 'a1', role: 'assistant', at: at(1), parent: 'u1', parts: [text('v1')] },
      { id: 'a2', role: 'assistant', at: at(2), parent: 'u1', parts: [text('v2')] },
      { id: 'u2', role: 'user', at: at(3), parent: 'a2', parts: [text('follow-up')] },
      { id: 'a3', role: 'assistant', at: at(4), parent: 'u2', parts: [text('answer')] },
    ])
    const next = switchVariant(t, t.activePath, { nodeId: 'a1', siblingOf: 'a2' })
    expect(next).toEqual(['u1', 'a1', ...[]])
    // the follow-up belongs to the discarded subtree and is dropped
    expect(next).not.toContain('u2')
  })

  it('switches top-level forks with an empty prefix', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('opening v1')] },
      { id: 'a1', role: 'assistant', at: at(1), parent: 'u1', parts: [text('r1')] },
      { id: 'u2', role: 'user', at: at(2), parent: null, parts: [text('opening v2')] },
      { id: 'a2', role: 'assistant', at: at(3), parent: 'u2', parts: [text('r2')] },
      { id: 'u3', role: 'user', at: at(4), parent: 'a2', parts: [text('more')] },
    ])
    const next = switchVariant(t, t.activePath, { nodeId: 'u1', siblingOf: 'u2' })
    expect(next).toEqual(['u1', 'a1'])
  })
})
