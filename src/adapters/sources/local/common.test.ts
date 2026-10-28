import { describe, expect, it } from 'vitest'

import type { NodeDraft } from './common'
import {
  buildTrajectory,
  parseJsonl,
  titleFromPrompt,
  toolTitleFromInput,
  toNodes,
  truncate,
} from './common'

describe('truncate', () => {
  it('leaves short text untouched', () => {
    const result = truncate('short', 16_000, 2000)
    expect(result).toEqual({ text: 'short', truncated: false, originalChars: 5 })
  })

  it('caps at the preview length and reports the original size', () => {
    const result = truncate('x'.repeat(20_000), 16_000, 2000)
    expect(result.text).toHaveLength(2000)
    expect(result.truncated).toBe(true)
    expect(result.originalChars).toBe(20_000)
  })

  it('never previews beyond the cap', () => {
    const result = truncate('x'.repeat(3000), 16_000, 5000)
    expect(result.text).toHaveLength(3000)
    expect(result.truncated).toBe(false)
  })
})

describe('titleFromPrompt', () => {
  it('collapses whitespace onto one line', () => {
    expect(titleFromPrompt('  a\n\n  b\tc  ')).toBe('a b c')
  })

  it('truncates with an ellipsis past 80 chars', () => {
    expect(titleFromPrompt('a'.repeat(100))).toHaveLength(81)
    expect(titleFromPrompt('a'.repeat(100))!.endsWith('…')).toBe(true)
  })

  it('returns empty for blank input', () => {
    expect(titleFromPrompt('   \n ')).toBe('')
  })
})

describe('toolTitleFromInput', () => {
  it('prefers command over other keys', () => {
    expect(toolTitleFromInput({ file_path: '/a', command: 'ls -la' })).toBe('ls -la')
  })

  it('falls through the key priority and truncates long values', () => {
    expect(toolTitleFromInput({ pattern: `${'x'.repeat(70)}` })).toHaveLength(61)
    expect(toolTitleFromInput({ file_path: '/x/y.ts' })).toBe('/x/y.ts')
  })

  it('ignores blank strings and non-objects', () => {
    expect(toolTitleFromInput({ command: '   ' })).toBeUndefined()
    expect(toolTitleFromInput('bash')).toBeUndefined()
    expect(toolTitleFromInput(null)).toBeUndefined()
  })
})

describe('parseJsonl', () => {
  it('parses valid lines and skips blanks and torn lines', () => {
    const lines = parseJsonl<{ n: number }>('{"n":1}\n\nnot json\n{"n":2}\n')
    expect(lines).toEqual([{ n: 1 }, { n: 2 }])
  })
})

describe('toNodes + buildTrajectory', () => {
  const drafts: NodeDraft[] = [
    { id: 'u1', at: 1, role: 'user', parts: [{ kind: 'text', text: 'q' }] },
    { id: 'a1', at: 2, role: 'assistant', model: 'm1', parts: [{ kind: 'text', text: 'r' }] },
    { id: 'u2', at: 3, role: 'user', parts: [{ kind: 'text', text: 'q2' }] },
  ]

  it('parent-links nodes in insertion order', () => {
    const nodes = toNodes(drafts)
    expect(nodes.get('u1')?.parentId).toBeNull()
    expect(nodes.get('a1')?.parentId).toBe('u1')
    expect(nodes.get('u2')?.parentId).toBe('a1')
    expect(nodes.get('a1')?.childIds).toEqual(['u2'])
    expect(nodes.get('u1')?.childIds).toEqual(['a1'])
  })

  it('builds a trajectory with a linear active path and title fallback', () => {
    const trajectory = buildTrajectory({ sourceId: 'test', rawId: 'r1', title: '', startedAt: 1, updatedAt: 3, drafts })
    expect(trajectory.id).toBe('test:r1')
    expect(trajectory.activePath).toEqual(['u1', 'a1', 'u2'])
    expect(trajectory.title).toBe('(untitled)')
  })

  it('produces connectivity-clean trees (invariant-safe by construction)', () => {
    const trajectory = buildTrajectory({ sourceId: 'test', rawId: 'r1', title: 't', startedAt: 1, updatedAt: 3, drafts })
    // multi-node trajectories must pass the connectivity invariant
    const reachable = new Set<string>()
    const stack = [...trajectory.nodes.values()].filter(n => n.parentId === null).map(n => n.id)
    while (stack.length) {
      const id = stack.pop()!
      if (reachable.has(id))
        continue
      reachable.add(id)
      stack.push(...trajectory.nodes.get(id)!.childIds)
    }
    expect(reachable.size).toBe(trajectory.nodes.size)
  })
})
