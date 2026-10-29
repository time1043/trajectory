import { describe, expect, it } from 'vitest'

import { at, makeTrajectory, search, text } from '../../test/fixtures'
import { buildDocumentView, resolveCitation } from './document-view'

describe('buildDocumentView', () => {
  it('produces one block per path node with latency on assistant blocks', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
      { id: 'a1', role: 'assistant', at: at(2), parent: 'u1', parts: [text('r')] },
    ])
    const view = buildDocumentView(t)
    expect(view.blocks.map((b) => b.node.id)).toEqual(['u1', 'a1'])
    expect(view.blocks[0]?.latencyMs).toBeNull()
    expect(view.blocks[1]?.latencyMs).toBe(at(2) - at(0))
  })

  it('numbers rewrite chains (consecutive user nodes)', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('draft')] },
      { id: 'u2', role: 'user', at: at(1), parent: 'u1', parts: [text('rewrite')] },
      { id: 'u3', role: 'user', at: at(2), parent: 'u2', parts: [text('rewrite again')] },
      { id: 'a1', role: 'assistant', at: at(3), parent: 'u3', parts: [text('answer')] },
    ])
    const view = buildDocumentView(t)
    expect(view.blocks.map((b) => b.chainIndex)).toEqual([0, 1, 2, 0])
  })

  it('marks pager positions only on forked nodes', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
      { id: 'a1', role: 'assistant', at: at(1), parent: 'u1', parts: [text('v1')] },
      { id: 'a2', role: 'assistant', at: at(2), parent: 'u1', parts: [text('v2')] },
    ])
    const view = buildDocumentView(t)
    // active path takes the last child (a2)
    expect(view.blocks.map((b) => [b.node.id, b.variant])).toEqual([
      ['u1', null],
      ['a2', { index: 2, count: 2 }],
    ])
  })

  it('dedupes references by url in first-appearance order', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
      {
        id: 'a1',
        role: 'assistant',
        at: at(1),
        parent: 'u1',
        parts: [
          search([
            { url: 'https://x/a', title: 'A' },
            { url: 'https://x/b', title: 'B' },
          ]),
          search([{ url: 'https://x/a', title: 'A again' }]),
          text('r'),
        ],
      },
      { id: 'u2', role: 'user', at: at(10), parent: 'a1', parts: [text('q2')] },
      {
        id: 'a2',
        role: 'assistant',
        at: at(11),
        parent: 'u2',
        parts: [search([{ url: 'https://x/c', title: 'C' }]), text('r2')],
      },
    ])
    const view = buildDocumentView(t)
    expect(view.references.map((r) => r.url)).toEqual(['https://x/a', 'https://x/b', 'https://x/c'])
  })

  it('resets the citation window at each user turn', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q1')] },
      {
        id: 'a1',
        role: 'assistant',
        at: at(1),
        parent: 'u1',
        parts: [search([{ url: 'https://x/1', title: 'one' }]), text('r1')],
      },
      { id: 'u2', role: 'user', at: at(10), parent: 'a1', parts: [text('q2')] },
      {
        id: 'a2',
        role: 'assistant',
        at: at(11),
        parent: 'u2',
        parts: [search([{ url: 'https://x/2', title: 'two' }]), text('r2')],
      },
    ])
    const view = buildDocumentView(t)
    expect(view.citationWindows.get('a1')?.map((r) => r.url)).toEqual(['https://x/1'])
    expect(view.citationWindows.get('a2')?.map((r) => r.url)).toEqual(['https://x/2'])
  })

  it('shares the window snapshot across assistant nodes of the same turn', () => {
    const t = makeTrajectory([
      { id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] },
      {
        id: 'a1',
        role: 'assistant',
        at: at(1),
        parent: 'u1',
        parts: [search([{ url: 'https://x/1', title: 'one' }]), text('step 1')],
      },
      { id: 'a2', role: 'assistant', at: at(2), parent: 'a1', parts: [text('step 2')] },
    ])
    const view = buildDocumentView(t)
    expect(view.citationWindows.get('a2')?.map((r) => r.url)).toEqual(['https://x/1'])
  })
})

describe('resolveCitation', () => {
  const references = [
    { url: 'https://x/a', title: 'A' },
    { url: 'https://x/b', title: 'B' },
    { url: 'https://x/c', title: 'C' },
  ]

  it('resolves within the turn window and maps to the stable registry number', () => {
    const window = [{ url: 'https://x/b', title: 'B' }]
    expect(resolveCitation(1, window, references)).toEqual({ result: window[0], refIndex: 2 })
  })

  it('falls back to the session registry when the window misses', () => {
    expect(resolveCitation(3, [], references)?.refIndex).toBe(3)
    expect(resolveCitation(2, undefined, references)?.refIndex).toBe(2)
  })

  it('degrades to null beyond both scopes', () => {
    expect(resolveCitation(99, references, references)).toBeNull()
    expect(resolveCitation(0, references, references)).toBeNull()
  })
})
