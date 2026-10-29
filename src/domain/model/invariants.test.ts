import { describe, expect, it } from 'vitest'

import type { Trajectory } from './trajectory'

import { makeTrajectory, text, at, reasoning } from '../../test/fixtures'
import { checkInvariants } from './invariants'

function spec(
  id: string,
  role: 'user' | 'assistant',
  minutes: number,
  parent: string | null,
  parts?: Parameters<typeof text>[0] | undefined,
) {
  return { id, role, at: at(minutes), parent, parts: parts ? [text(parts)] : undefined }
}

describe('defaultActivePath', () => {
  it('follows a linear chain', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'hello'),
    ])
    expect(t.activePath).toEqual(['u1', 'a1'])
  })

  it('takes the last child at every fork', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'v1'),
      spec('a2', 'assistant', 2, 'u1', 'v2'),
      spec('u2', 'user', 3, 'a2', 'next'),
    ])
    expect(t.activePath).toEqual(['u1', 'a2', 'u2'])
  })

  it('treats multiple top-level nodes as forks of a virtual root', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'opening v1'),
      spec('u2', 'user', 1, null, 'opening v2'),
      spec('a1', 'assistant', 2, 'u2', 'answer'),
    ])
    expect(t.activePath).toEqual(['u2', 'a1'])
  })
})

describe('checkInvariants', () => {
  it('accepts a valid trajectory', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'hello'),
    ])
    expect(checkInvariants(t)).toEqual([])
  })

  it('detects dangling child references and unreachable nodes', () => {
    const t = makeTrajectory([spec('u1', 'user', 0, null, 'hi')])
    // a reachable node referencing a missing child, plus an orphan sibling
    const nodes = new Map(t.nodes)
    nodes.set('u1', { ...t.nodes.get('u1')!, childIds: ['ghost'] })
    nodes.set('orphan', { ...t.nodes.get('u1')!, id: 'orphan', parentId: null, childIds: [] })
    const violations = checkInvariants({ ...t, nodes }).join('\n')
    expect(violations).toContain('dangling reference to ghost')
    expect(violations).toContain('unreachable node(s)')
  })

  it('detects cycles', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'hello'),
    ])
    // a1 links back to u1 — the cycle is reachable from the top level
    const cyclic = {
      ...t,
      nodes: new Map(t.nodes).set('a1', { ...t.nodes.get('a1')!, childIds: ['u1'] }),
    } as Trajectory
    expect(checkInvariants(cyclic).join('\n')).toContain('cycle or shared child')
  })

  it('flags user nodes carrying assistant-side parts (I3)', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'hello'),
    ])
    const polluted = {
      ...t,
      nodes: new Map(t.nodes).set('u1', {
        ...t.nodes.get('u1')!,
        parts: [text('hi'), reasoning('sneaky chain of thought')],
      }),
    } as Trajectory
    expect(checkInvariants(polluted).join('\n')).toContain(
      'user node u1 carries assistant-side parts',
    )
  })

  it('flags non-ascending childIds (I4)', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      // declared in this order but a1 actually came later than a2
      { id: 'a1', role: 'assistant', at: at(5), parent: 'u1', parts: [text('late')] },
      { id: 'a2', role: 'assistant', at: at(1), parent: 'u1', parts: [text('early')] },
    ])
    expect(checkInvariants(t).join('\n')).toContain('childIds not ascending')
  })

  it('flags a broken activePath (I6)', () => {
    const t = makeTrajectory([
      spec('u1', 'user', 0, null, 'hi'),
      spec('a1', 'assistant', 1, 'u1', 'hello'),
    ])
    const broken = { ...t, activePath: ['ghost', 'a1'] } as Trajectory
    expect(checkInvariants(broken).join('\n')).toContain(
      'activePath does not start at a top-level node',
    )
  })
})
