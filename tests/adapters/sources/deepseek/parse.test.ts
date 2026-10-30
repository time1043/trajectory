import { describe, expect, it } from 'vitest'

import type {
  RawConversation,
  RawFragment,
  RawMappingNode,
  RawMessage,
  RawUser,
} from '@/adapters/sources/deepseek/types'
import type { QuerySqlite, SourceManifest } from '@/domain/ports/data-host'

import { deepseekAdapter } from '@/adapters/sources/deepseek/adapter'

// ---------------------------------------------------------------------------
// Fixture: one export with a forked conversation (conv_a), a titleless linear
// one (conv_b) and an assistant-only one (conv_c — no user turn, not listed).
// conv_a forks twice: at the root (u1 vs u2 — question rewrites) and under a2
// (r1 vs r2 — regenerates). The active path is the latest branch at every
// fork: u2 -> a2 -> r2 -> u3 -> a3.
// ---------------------------------------------------------------------------

const T = {
  u1: '2026-01-01T00:00:01.000Z',
  u2: '2026-01-01T00:00:02.000Z',
  a2: '2026-01-01T00:00:03.000Z',
  r1: '2026-01-01T00:00:04.000Z',
  r2: '2026-01-01T00:00:05.000Z',
  u3: '2026-01-01T00:00:06.000Z',
  a3: '2026-01-01T00:00:07.000Z',
  a1: '2026-01-01T00:01:30.000Z',
  convAUpdated: '2026-01-01T00:02:00.000Z',
  bU: '2026-01-02T00:00:10.000Z',
  bA: '2026-01-02T00:00:11.000Z',
  cA: '2026-01-03T00:00:20.000Z',
} as const

function msg(insertedAt: string, fragments: RawFragment[]): RawMessage {
  return { model: 'deepseek-chat', inserted_at: insertedAt, fragments }
}

function node(
  id: string,
  parent: string | null,
  children: string[],
  message: RawMessage | null,
): RawMappingNode {
  return { id, parent, children, message }
}

const CONV_A: RawConversation = {
  id: 'conv_a',
  title: 'Forked chat',
  inserted_at: T.u1,
  updated_at: T.convAUpdated,
  mapping: {
    // children deliberately listed out of time order — the walk must sort
    root: node('root', null, ['u2', 'u1'], null),
    u1: node('u1', 'root', ['a1'], msg(T.u1, [{ type: 'REQUEST', content: 'opening v1' }])),
    a1: node('a1', 'u1', [], msg(T.a1, [{ type: 'RESPONSE', content: 'old branch' }])),
    u2: node(
      'u2',
      'root',
      ['a2'],
      msg(T.u2, [
        { type: 'REQUEST', content: 'opening v2' },
        { type: 'FILE', files: [{ file_id: 'f1', file_name: 'spec.pdf', file_size: 2048 }] },
      ]),
    ),
    a2: node(
      'a2',
      'u2',
      ['r2', 'r1'],
      msg(T.a2, [
        { type: 'THINK', content: 'thinking...' },
        { type: 'RESPONSE', content: 'answer v2' },
      ]),
    ),
    r1: node('r1', 'a2', [], msg(T.r1, [{ type: 'RESPONSE', content: 'regenerate v1' }])),
    r2: node(
      'r2',
      'a2',
      ['u3'],
      msg(T.r2, [
        { type: 'RESPONSE', content: 'regenerate v2' },
        { type: 'SEARCH', results: [{ url: 'https://example.com/a', title: 'Result A' }] },
        { type: 'TOOL_OPEN' },
      ]),
    ),
    u3: node('u3', 'r2', ['a3'], msg(T.u3, [{ type: 'REQUEST', content: 'follow-up' }])),
    a3: node(
      'a3',
      'u3',
      [],
      msg(T.a3, [
        { type: 'RESPONSE', content: 'final answer' },
        { type: 'MYSTERY' }, // unrecognized fragment type -> unknown bucket
      ]),
    ),
  },
}

const CONV_B: RawConversation = {
  id: 'conv_b',
  title: '', // empty export title -> (untitled)
  inserted_at: T.bU,
  updated_at: T.bA,
  mapping: {
    root: node('root', null, ['b_u'], null),
    b_u: node('b_u', 'root', ['b_a'], msg(T.bU, [{ type: 'REQUEST', content: 'hello?' }])),
    b_a: node('b_a', 'b_u', [], msg(T.bA, [{ type: 'RESPONSE', content: 'hi' }])),
  },
}

const CONV_C: RawConversation = {
  id: 'conv_c',
  title: 'lonely', // assistant-only -> no user turn -> never listed
  inserted_at: T.cA,
  updated_at: T.cA,
  mapping: {
    root: node('root', null, ['c_a'], null),
    c_a: node('c_a', 'root', [], msg(T.cA, [{ type: 'RESPONSE', content: 'lonely' }])),
  },
}

const USER: RawUser = {
  user_id: '1234567890abcdef',
  email: 'oswin@example.com',
  mobile: { mobile_number: '13800001234', area_code: '+86' },
  oauth_profiles: [{ provider: 'google', profile_json: JSON.stringify({ name: 'Oswin' }) }],
}

const FILES = new Map<string, string>([
  ['web/deepseek/oswin/conversations.json', JSON.stringify([CONV_A, CONV_B, CONV_C])],
  ['web/deepseek/oswin/user.json', JSON.stringify(USER)],
])

const manifest: SourceManifest = {
  dirName: 'web/deepseek/oswin',
  files: [...FILES.keys()].map((path) => ({ path, size: 1, mtimeMs: 0 })),
}

function bytes(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text)
  const out = new ArrayBuffer(u8.byteLength)
  new Uint8Array(out).set(u8)
  return out
}

const fetchFile = async (path: string): Promise<ArrayBuffer> => {
  const raw = FILES.get(path)
  if (raw === undefined) throw new Error(`fixture: no such file ${path}`)
  return bytes(raw)
}

// deepseek is file-based — sqlite is never touched; a loud stub would catch
// any accidental query
const noSqlite: QuerySqlite = async () => ({ rows: [] })

describe('deepseek adapter (index/body split over conversations.json)', () => {
  it('detect: claims only manifests carrying conversations.json', () => {
    expect(deepseekAdapter.detect(manifest)).toBe(true)
    expect(
      deepseekAdapter.detect({
        dirName: 'x',
        files: [{ path: 'a/user.json', size: 1, mtimeMs: 0 }],
      }),
    ).toBe(false)
  })

  it('index: one summary per conversation with a user turn; turnStarts from the active path', async () => {
    const index = await deepseekAdapter.index({ manifest, fetchFile, querySqlite: noSqlite })
    expect(index.sourceId).toBe('deepseek:oswin')
    expect(index.sessions).toHaveLength(2) // conv_c has no user turn -> dropped

    const a = index.sessions.find((s) => s.sessionId === 'conv_a')!
    expect(a.id).toBe('deepseek:oswin:conv_a')
    expect(a.title).toBe('Forked chat')
    expect(a.turnStarts).toEqual([Date.parse(T.u2), Date.parse(T.u3)])
    expect(a.messageCount).toBe(5) // active path u2 -> a2 -> r2 -> u3 -> a3
    expect(a.firstPrompt).toBe('opening v2') // u1's discarded branch must not leak in
    expect(a.startedAt).toBe(Date.parse(T.u2))
    expect(a.updatedAt).toBe(Date.parse(T.convAUpdated))

    const b = index.sessions.find((s) => s.sessionId === 'conv_b')!
    expect(b.title).toBe('(untitled)') // empty export title falls back
    expect(b.turnStarts).toEqual([Date.parse(T.bU)])
    expect(b.messageCount).toBe(2)
    expect(b.firstPrompt).toBe('hello?')
  })

  it('index: masks the user.json PII into a profile', async () => {
    const index = await deepseekAdapter.index({ manifest, fetchFile, querySqlite: noSqlite })
    expect(index.profile).toEqual({
      displayName: 'Oswin',
      identifiers: ['osw****@example.com', '138****234'],
    })
  })

  it('loadSession: full tree with the root sentinel erased', async () => {
    const t = await deepseekAdapter.loadSession(
      { manifest, fetchFile, querySqlite: noSqlite },
      'conv_a',
    )
    expect(t).not.toBeNull()
    expect(t!.id).toBe('deepseek:oswin:conv_a')
    expect(t!.title).toBe('Forked chat')
    expect(t!.nodes.size).toBe(8) // every mapping node with a message, root excluded
    expect(t!.nodes.has('root')).toBe(false)
    expect(t!.nodes.get('u1')!.parentId).toBeNull() // root erased -> top-level fork
    expect(t!.nodes.get('u2')!.parentId).toBeNull()
    expect(t!.activePath).toEqual(['u2', 'a2', 'r2', 'u3', 'a3'])
    expect(t!.nodes.get('a2')!.childIds).toEqual(['r1', 'r2']) // fixture listed ['r2','r1'] — sorted by at
  })

  it('loadSession: fragments map onto Part kinds', async () => {
    const t = (await deepseekAdapter.loadSession(
      { manifest, fetchFile, querySqlite: noSqlite },
      'conv_a',
    ))!

    const u2 = t.nodes.get('u2')!
    expect(u2.role).toBe('user')
    expect(u2.parts[0]).toEqual({ kind: 'text', text: 'opening v2' }) // REQUEST
    expect(u2.parts[1]).toEqual({
      kind: 'attachment', // FILE
      files: [{ fileId: 'f1', fileName: 'spec.pdf', fileSize: 2048 }],
    })

    const a2 = t.nodes.get('a2')!
    expect(a2.role).toBe('assistant')
    expect(a2.model).toBe('deepseek-chat')
    expect(a2.parts[0]).toEqual({ kind: 'reasoning', text: 'thinking...' }) // THINK
    expect(a2.parts[1]).toEqual({ kind: 'text', text: 'answer v2' }) // RESPONSE

    const r2 = t.nodes.get('r2')!
    expect(r2.parts[0]).toEqual({ kind: 'text', text: 'regenerate v2' })
    expect(r2.parts[1]).toEqual({
      kind: 'search', // SEARCH
      results: [{ url: 'https://example.com/a', title: 'Result A' }],
    })
    expect(r2.parts[2]).toEqual({ kind: 'tool-call', tool: 'open' }) // TOOL_OPEN

    const a3 = t.nodes.get('a3')!
    expect(a3.parts[1]).toEqual({ kind: 'unknown', rawType: 'MYSTERY' }) // keeps its raw type
  })

  it('loadSession: unknown session id -> null', async () => {
    const t = await deepseekAdapter.loadSession(
      { manifest, fetchFile, querySqlite: noSqlite },
      'nope',
    )
    expect(t).toBeNull()
  })
})
