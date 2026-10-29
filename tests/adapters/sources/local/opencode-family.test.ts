import { describe, expect, it } from 'vitest'

import type { QuerySqlite, SourceManifest } from '@/domain/ports/data-host'

import { zcodeAdapter } from '@/adapters/sources/zcode/adapter'

const manifest: SourceManifest = {
  dirName: 'local/zcode/oswin-m4a',
  files: [{ path: 'local/zcode/oswin-m4a/db.sqlite', size: 1, mtimeMs: 0 }],
}

const SESSION_ID = 'sess_1'

const SESSIONS = [
  {
    id: SESSION_ID,
    title: 'Real session',
    time_created: 100,
    time_updated: 900,
    task_type: 'interactive',
    path: '/p',
  },
  {
    id: 'sess_sub',
    title: 'subagent',
    time_created: 50,
    time_updated: 60,
    task_type: 'subagent_child',
    path: '/p',
  },
]

const SKELETON = [
  {
    sid: SESSION_ID,
    role: 'user',
    kind: 'user_prompt',
    origin: 'real_user',
    vis: 'visible',
    at: 100,
  },
  {
    sid: SESSION_ID,
    role: 'user',
    kind: 'todo_reminder',
    origin: 'system',
    vis: 'hidden',
    at: 150,
  },
  {
    sid: SESSION_ID,
    role: 'assistant',
    kind: 'assistant_response',
    origin: null,
    vis: 'visible',
    at: 200,
  },
]

const MESSAGES = [
  {
    sessionId: SESSION_ID,
    id: 'm1',
    time_created: 100,
    data: JSON.stringify({
      role: 'user',
      semantics: { kind: 'user_prompt', origin: 'real_user', uiVisibility: 'visible' },
    }),
  },
  {
    sessionId: SESSION_ID,
    id: 'm2',
    time_created: 150,
    data: JSON.stringify({
      role: 'user',
      semantics: { kind: 'todo_reminder', uiVisibility: 'hidden' },
    }),
  },
  {
    sessionId: SESSION_ID,
    id: 'm3',
    time_created: 200,
    data: JSON.stringify({
      role: 'assistant',
      semantics: { kind: 'assistant_response', uiVisibility: 'visible' },
    }),
  },
]

const PARTS = [
  {
    sessionId: SESSION_ID,
    message_id: 'm1',
    sequence: 0,
    data: JSON.stringify({ type: 'text', text: 'real question' }),
  },
  {
    sessionId: SESSION_ID,
    message_id: 'm1',
    sequence: 1,
    data: JSON.stringify({ type: 'text', text: 'injected', synthetic: true }),
  },
  {
    sessionId: SESSION_ID,
    message_id: 'm3',
    sequence: 0,
    data: JSON.stringify({ type: 'reasoning', text: 'c'.repeat(10_000) }),
  },
  {
    sessionId: SESSION_ID,
    message_id: 'm3',
    sequence: 1,
    data: JSON.stringify({
      type: 'tool',
      tool: 'Bash',
      state: { status: 'error', input: { command: 'ls -la /x' }, output: '', error: 'boom' },
    }),
  },
]

function fakeQuerySqlite(table: {
  sessions: { id: string }[]
  skeleton: Record<string, unknown>[]
  messages: Record<string, unknown>[]
  parts: Record<string, unknown>[]
}): QuerySqlite {
  return async (_path, sql, params = []) => {
    if (sql.includes('FROM message m JOIN session')) return { rows: table.skeleton }
    if (sql.includes('FROM message WHERE session_id'))
      return { rows: table.messages.filter((r) => r.sessionId === params[0]) }
    if (sql.includes('FROM session WHERE time_deleted')) return { rows: table.sessions }
    if (sql.includes('FROM session WHERE id = ?'))
      return { rows: table.sessions.filter((r) => r.id === params[0]) }
    if (sql.includes('FROM part WHERE session_id'))
      return { rows: table.parts.filter((r) => r.sessionId === params[0]) }
    if (sql.includes('ROW_NUMBER')) return { rows: [] }
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`)
  }
}

const TABLE = {
  sessions: SESSIONS,
  skeleton: SKELETON,
  messages: MESSAGES.map((m) => ({ ...m, sessionId: SESSION_ID })),
  parts: PARTS.map((p) => ({ ...p, sessionId: SESSION_ID })),
}

describe('zcode adapter (index/body split)', () => {
  it('index: filters noise, returns summaries without bodies', async () => {
    const index = await zcodeAdapter.index({
      manifest,
      fetchFile: async () => new ArrayBuffer(0),
      querySqlite: fakeQuerySqlite(TABLE),
    })
    expect(index.sourceId).toBe('zcode:oswin-m4a')
    expect(index.sessions).toHaveLength(1) // subagent filtered by task_type
    const session = index.sessions[0]!
    expect(session.sessionId).toBe(SESSION_ID)
    expect(session.messageCount).toBe(2) // m1 + m3, m2 dropped
    expect(session.turnStarts).toEqual([100])
  })

  it('loadSession: returns the full body with parts', async () => {
    const trajectory = await zcodeAdapter.loadSession(
      { manifest, fetchFile: async () => new ArrayBuffer(0), querySqlite: fakeQuerySqlite(TABLE) },
      SESSION_ID,
    )
    expect(trajectory).not.toBeNull()
    expect(trajectory!.id).toBe(`zcode:oswin-m4a:${SESSION_ID}`)
    const nodes = [...trajectory!.nodes.values()]
    expect(nodes.length).toBeGreaterThanOrEqual(2)
    expect(nodes[0]?.parts[0]?.kind).toBe('text')
    expect(nodes[1]?.parts[0]?.kind).toBe('reasoning')
    expect(nodes[1]?.parts[1]?.kind).toBe('tool-call')
  })

  it('detect: only db.sqlite claims the manifest', () => {
    expect(zcodeAdapter.detect(manifest)).toBe(true)
    expect(zcodeAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })
})
