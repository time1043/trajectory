import { describe, expect, it } from 'vitest'

import type { QuerySqlite, SourceManifest } from '@/domain/ports/data-host'

import { opencodeAdapter } from '@/adapters/sources/opencode/adapter'
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

// ---------------------------------------------------------------------------
// opencode — same family, different dialect: no semantics columns (every
// skeleton row counts), default "New session - <ISO>" titles fall back to the
// first user prompt, and step envelopes / compaction markers are not dialogue.
// ---------------------------------------------------------------------------

const OC_MANIFEST: SourceManifest = {
  dirName: 'local/opencode/oswin',
  files: [{ path: 'local/opencode/oswin/opencode.db', size: 1, mtimeMs: 0 }],
}

const OC_SESSIONS = [
  {
    id: 'oc_1',
    title: 'New session - 2026-01-01T00:00:00.000Z',
    time_created: 100,
    time_updated: 900,
    parent_id: null,
    directory: '/p',
  },
  {
    id: 'oc_2',
    title: '',
    time_created: 200,
    time_updated: 800,
    parent_id: null,
    directory: '/p',
  },
]

const OC_SKELETON = [
  { sid: 'oc_1', role: 'user', at: 150 },
  { sid: 'oc_1', role: 'assistant', at: 200 },
  { sid: 'oc_1', role: 'user', at: 300 },
  { sid: 'oc_2', role: 'user', at: 400 },
]

const OC_FIRST_PROMPTS = [{ sid: 'oc_1', txt: 'how do I fork?' }]

const OC_MESSAGES = [
  { sessionId: 'oc_1', id: 'm1', time_created: 150, data: JSON.stringify({ role: 'user' }) },
  {
    sessionId: 'oc_1',
    id: 'm2',
    time_created: 200,
    data: JSON.stringify({ role: 'assistant', modelID: 'claude-opus-4' }),
  },
  { sessionId: 'oc_1', id: 'm3', time_created: 300, data: JSON.stringify({ role: 'user' }) },
  { sessionId: 'oc_2', id: 'm4', time_created: 400, data: JSON.stringify({ role: 'user' }) },
]

const DATA_URL = 'data:image/png;base64,AAAA'

const OC_PARTS = [
  {
    sessionId: 'oc_1',
    message_id: 'm1',
    time_created: 150,
    data: JSON.stringify({ type: 'text', text: 'how do I fork?' }),
  },
  // step envelopes are machinery, not dialogue — dropped
  {
    sessionId: 'oc_1',
    message_id: 'm2',
    time_created: 200,
    data: JSON.stringify({ type: 'step-start' }),
  },
  {
    sessionId: 'oc_1',
    message_id: 'm2',
    time_created: 201,
    data: JSON.stringify({ type: 'reasoning', text: 'r'.repeat(9_000) }),
  },
  {
    sessionId: 'oc_1',
    message_id: 'm2',
    time_created: 202,
    data: JSON.stringify({
      type: 'tool',
      tool: 'Bash',
      state: { status: 'error', input: { command: 'rm -rf /tmp/x' }, output: '', error: 'boom' },
    }),
  },
  {
    sessionId: 'oc_1',
    message_id: 'm2',
    time_created: 203,
    data: JSON.stringify({ type: 'patch', files: ['a.ts', 'b.ts'] }),
  },
  {
    sessionId: 'oc_1',
    message_id: 'm2',
    time_created: 204,
    data: JSON.stringify({ type: 'mystery' }),
  },
  {
    sessionId: 'oc_1',
    message_id: 'm3',
    time_created: 300,
    data: JSON.stringify({ type: 'file', mime: 'image/png', url: DATA_URL, id: 'img1' }),
  },
]

interface OcTable {
  sessions: Record<string, unknown>[]
  skeleton: Record<string, unknown>[]
  firstPrompts: Record<string, unknown>[]
  messages: Record<string, unknown>[]
  parts: Record<string, unknown>[]
}

/** Router for the opencode dialect's SQL, recording every issued statement */
function ocHarness(table: OcTable): { querySqlite: QuerySqlite; issued: string[] } {
  const issued: string[] = []
  const querySqlite: QuerySqlite = async (_path, sql, params = []) => {
    issued.push(sql)
    if (sql.includes('ROW_NUMBER()')) return { rows: table.firstPrompts }
    if (sql.includes('FROM message m ORDER BY')) return { rows: table.skeleton }
    if (sql.includes('FROM session WHERE id = ?'))
      return { rows: table.sessions.filter((r) => r.id === params[0]) }
    if (sql.includes('FROM session ORDER BY')) return { rows: table.sessions }
    if (sql.includes('FROM message WHERE session_id'))
      return { rows: table.messages.filter((r) => r.sessionId === params[0]) }
    if (sql.includes('FROM part WHERE session_id'))
      return { rows: table.parts.filter((r) => r.sessionId === params[0]) }
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`)
  }
  return { querySqlite, issued }
}

const OC_TABLE: OcTable = {
  sessions: OC_SESSIONS,
  skeleton: OC_SKELETON,
  firstPrompts: OC_FIRST_PROMPTS,
  messages: OC_MESSAGES,
  parts: OC_PARTS,
}

const ocInput = (querySqlite: QuerySqlite) => ({
  manifest: OC_MANIFEST,
  fetchFile: async () => new ArrayBuffer(0),
  querySqlite,
})

describe('opencode adapter (opencode-family dialect)', () => {
  it('detect: only opencode.db claims the manifest', () => {
    expect(opencodeAdapter.detect(OC_MANIFEST)).toBe(true)
    expect(opencodeAdapter.detect(manifest)).toBe(false) // zcode's db.sqlite
  })

  it('index: no semantics filter — every message counts; "New session -" titles fall back to the first prompt', async () => {
    const { querySqlite, issued } = ocHarness(OC_TABLE)
    const index = await opencodeAdapter.index(ocInput(querySqlite))
    expect(index.sourceId).toBe('opencode:oswin')
    expect(index.sessions).toHaveLength(2)

    const s1 = index.sessions.find((s) => s.sessionId === 'oc_1')!
    expect(s1.title).toBe('how do I fork?') // "New session - <ISO>" -> first prompt
    expect(s1.turnStarts).toEqual([150, 300])
    expect(s1.messageCount).toBe(3)
    expect(s1.startedAt).toBe(100) // from the session row, not the first message
    expect(s1.firstPrompt).toBe('how do I fork?')

    const s2 = index.sessions.find((s) => s.sessionId === 'oc_2')!
    expect(s2.title).toBe('(untitled)') // no title and no first prompt
    expect(s2.turnStarts).toEqual([400])
    expect(s2.messageCount).toBe(1)

    // the index pass must not touch message/part bodies
    expect(issued.some((sql) => sql.includes('FROM message WHERE session_id'))).toBe(false)
    expect(issued.some((sql) => sql.includes('FROM part WHERE session_id'))).toBe(false)
  })

  it('loadSession: step envelopes dropped, patch/file/mystery mapped, reasoning capped', async () => {
    const { querySqlite } = ocHarness(OC_TABLE)
    const t = await opencodeAdapter.loadSession(ocInput(querySqlite), 'oc_1')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('opencode:oswin:oc_1')
    expect(t!.title).toBe('how do I fork?') // same fallback as index — h1 must match the list
    expect(t!.startedAt).toBe(100)
    expect(t!.nodes.size).toBe(3) // m1, m2, m3
    expect(t!.activePath).toEqual(['m1', 'm2', 'm3'])

    const m1 = t!.nodes.get('m1')!
    expect(m1.parentId).toBeNull()
    expect(m1.model).toBeNull()
    expect(m1.parts).toEqual([{ kind: 'text', text: 'how do I fork?' }])

    const m2 = t!.nodes.get('m2')!
    expect(m2.model).toBe('claude-opus-4')
    expect(m2.parts).toHaveLength(4) // step-start dropped
    expect(m2.parts[0]).toEqual({ kind: 'reasoning', text: 'r'.repeat(8_000) }) // 9000 -> capped
    expect(m2.parts[1]).toEqual({
      kind: 'tool-call',
      tool: 'Bash',
      payload: {
        title: 'rm -rf /tmp/x',
        input: { command: 'rm -rf /tmp/x' },
        output: 'boom',
        truncated: false,
        originalChars: 4,
        error: 'boom',
      },
    })
    expect(m2.parts[2]).toEqual({
      kind: 'tool-call',
      tool: 'patch',
      payload: { title: '2 files changed', input: ['a.ts', 'b.ts'] },
    })
    expect(m2.parts[3]).toEqual({ kind: 'unknown', rawType: 'mystery' })

    const m3 = t!.nodes.get('m3')!
    expect(m3.parts).toEqual([
      {
        kind: 'attachment',
        files: [{ fileId: `image/png@${DATA_URL.length}`, fileName: 'image/png', fileSize: 0 }],
      },
    ])
  })

  it('loadSession: unknown session id -> null', async () => {
    const { querySqlite } = ocHarness(OC_TABLE)
    const t = await opencodeAdapter.loadSession(ocInput(querySqlite), 'nope')
    expect(t).toBeNull()
  })
})
