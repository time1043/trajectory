import { describe, expect, it } from 'vitest'

import type { QuerySqlite, SourceManifest } from '@/domain/ports/data-host'

import { opencodeAdapter } from '@/adapters/sources/opencode/adapter'
import { zcodeAdapter } from '@/adapters/sources/zcode/adapter'

const manifest: SourceManifest = {
  dirName: 'local/zcode/oswin-m4a',
  files: [{ path: 'local/test/db.sqlite', size: 1, mtimeMs: 0 }],
}

const opencodeManifest: SourceManifest = {
  dirName: 'local/opencode/oswin',
  files: [{ path: 'local/test-opencode/opencode.db', size: 1, mtimeMs: 0 }],
}

/** Minimal in-memory sqlite stand-in: routes SELECTs against fixture tables */
function fakeQuerySqlite(table: {
  sessions: Record<string, unknown>[]
  messages: Record<string, unknown>[]
  parts: Record<string, unknown>[]
}): QuerySqlite {
  return async (_path, sql, params = []) => {
    if (sql.includes('FROM session')) return { rows: table.sessions }
    if (sql.includes('FROM message'))
      return { rows: table.messages.filter((r) => r.sessionId === params[0]) }
    if (sql.includes('FROM part'))
      return { rows: table.parts.filter((r) => r.sessionId === params[0]) }
    throw new Error(`unexpected sql: ${sql}`)
  }
}

function toolPayload(
  parts: readonly { kind: string; payload?: unknown }[] | undefined,
  index: number,
): Record<string, unknown> {
  const part = parts?.[index]
  if (part?.kind !== 'tool-call') throw new Error(`expected tool-call at index ${index}`)
  return (part.payload ?? {}) as Record<string, unknown>
}

const SESSION_ID = 'sess_1'

const zcodeTable = {
  sessions: [
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
  ],
  messages: [
    {
      sessionId: SESSION_ID,
      id: 'm1',
      time_created: 100,
      data: JSON.stringify({
        role: 'user',
        semantics: { kind: 'user_prompt', origin: 'real_user', uiVisibility: 'visible' },
      }),
    },
    // agent-injected noise: dropped
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
    {
      sessionId: SESSION_ID,
      id: 'm4',
      time_created: 250,
      data: JSON.stringify({
        role: 'assistant',
        semantics: { kind: 'assistant_response', uiVisibility: 'hidden' },
      }),
    },
  ],
  parts: [
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
    {
      sessionId: SESSION_ID,
      message_id: 'm3',
      sequence: 2,
      data: JSON.stringify({ type: 'step-start' }),
    },
    {
      sessionId: SESSION_ID,
      message_id: 'm3',
      sequence: 3,
      data: JSON.stringify({ type: 'mystery' }),
    },
  ],
}

describe('zcode adapter', () => {
  it('claims manifests containing db.sqlite', () => {
    expect(zcodeAdapter.detect(manifest)).toBe(true)
    expect(zcodeAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })

  it('parses visible dialogue only, truncates reasoning, flags tool errors', async () => {
    const source = await zcodeAdapter.parse({
      manifest,
      fetchFile: async () => new ArrayBuffer(0),
      querySqlite: fakeQuerySqlite(zcodeTable),
    })

    expect(source.sourceId).toBe('zcode:oswin-m4a')
    expect(source.label).toBe('ZCode · oswin-m4a')
    // the subagent session is machinery and stays out of the list
    expect(source.trajectories).toHaveLength(1)
    const trajectory = source.trajectories[0]!
    expect(trajectory.id).toBe('zcode:oswin-m4a:sess_1')
    expect(source.label).toBe('ZCode · oswin-m4a')

    const nodes = [...trajectory.nodes.values()]
    expect(nodes.map((n) => n.id)).toEqual(['m1', 'm3'])
    // synthetic text inside the user message is dropped
    expect(nodes[0]?.parts).toEqual([{ kind: 'text', text: 'real question' }])
    // reasoning truncates at the 8k cap; the tool error surfaces
    const reasoningPart = nodes[1]?.parts[0]
    expect(reasoningPart?.kind === 'reasoning' && reasoningPart.text).toHaveLength(8000)
    const toolPart = nodes[1]?.parts[1]
    expect(toolPart?.kind === 'tool-call' && toolPart.payload).toMatchObject({
      title: 'ls -la /x',
      output: 'boom',
      error: 'boom',
    })
    // step-start is machinery; unknown kinds are counted, not dropped silently
    expect(nodes[1]?.parts).toHaveLength(2)
    expect(source.diagnostics.unknownPartCounts.mystery).toBe(1)
  })

  it('yields no trajectory when a session carries no visible messages', async () => {
    const source = await zcodeAdapter.parse({
      manifest,
      fetchFile: async () => new ArrayBuffer(0),
      querySqlite: fakeQuerySqlite({
        sessions: [{ id: 's', title: '', time_created: 500, time_updated: 100 }],
        messages: [],
        parts: [],
      }),
    })
    expect(source.trajectories).toEqual([])
  })
})

const opencodeTable = {
  sessions: [
    {
      sessionId: '_',
      id: 'ses_1',
      title: 'New session - 2026-04-24T03:37:27.641Z',
      time_created: 100,
      time_updated: 900,
      directory: '/p',
    },
  ],
  messages: [
    { sessionId: 'ses_1', id: 'om1', time_created: 100, data: JSON.stringify({ role: 'user' }) },
    {
      sessionId: 'ses_1',
      id: 'om2',
      time_created: 200,
      data: JSON.stringify({ role: 'assistant' }),
    },
  ],
  parts: [
    {
      sessionId: 'ses_1',
      message_id: 'om1',
      time_created: 100,
      data: JSON.stringify({ type: 'text', text: 'zustand type error' }),
    },
    {
      sessionId: 'ses_1',
      message_id: 'om2',
      time_created: 200,
      data: JSON.stringify({ type: 'patch', files: ['/a.ts', '/b.ts'] }),
    },
    {
      sessionId: 'ses_1',
      message_id: 'om2',
      time_created: 210,
      data: JSON.stringify({ type: 'compaction' }),
    },
  ],
}

describe('opencode adapter', () => {
  it('claims manifests containing opencode.db', () => {
    expect(opencodeAdapter.detect(opencodeManifest)).toBe(true)
  })

  it('falls back to the first prompt for default titles and renders patches', async () => {
    const source = await opencodeAdapter.parse({
      manifest: opencodeManifest,
      fetchFile: async () => new ArrayBuffer(0),
      querySqlite: fakeQuerySqlite(opencodeTable),
    })
    expect(source.trajectories[0]?.title).toBe('zustand type error')
    const assistant = [...source.trajectories[0]!.nodes.values()][1]
    const patch = assistant?.parts[0]
    expect(patch?.kind).toBe('tool-call')
    expect(patch?.kind === 'tool-call' && patch.tool).toBe('patch')
    expect(toolPayload(assistant?.parts, 0)).toMatchObject({ title: '2 files changed' })
    // compaction is machinery
    expect(assistant?.parts).toHaveLength(1)
  })

  it('orders parts by time when the schema has no sequence column', async () => {
    const source = await opencodeAdapter.parse({
      manifest: opencodeManifest,
      fetchFile: async () => new ArrayBuffer(0),
      querySqlite: fakeQuerySqlite({ ...opencodeTable, parts: [...opencodeTable.parts].reverse() }),
    })
    const assistant = [...source.trajectories[0]!.nodes.values()][1]
    expect(assistant?.parts[0]?.kind).toBe('tool-call')
    expect(assistant?.parts).toHaveLength(1)
  })
})
