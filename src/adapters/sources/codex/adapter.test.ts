import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'
import { codexAdapter } from './adapter'

const manifest: SourceManifest = {
  dirName: 'local/codex',
  files: [{ path: 'local/codex/sessions/2026/10/20/rollout-2026-10-20T10-00-00-00000000-0000-4000-8000-000000000000.jsonl', size: 1, mtimeMs: 0 }],
}

const FIXTURE = [
  JSON.stringify({ timestamp: '2026-10-20T02:00:00Z', type: 'session_meta', payload: { cwd: '/proj', session_id: '00000000-0000-4000-8000-000000000000' } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:01Z', type: 'turn_context', payload: { model: 'gpt-5' } }),
  // environment wrapper: not the user's voice
  JSON.stringify({ timestamp: '2026-10-20T02:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context><cwd>/proj</cwd></environment_context>' }] } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the bug please' }] } }),
  // reasoning with encrypted content only: unreadable, dropped
  JSON.stringify({ timestamp: '2026-10-20T02:00:04Z', type: 'response_item', payload: { type: 'reasoning', summary: [], content: null, encrypted_content: 'gAAAA' } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:05Z', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'looking at tests' }] } }),
  // arguments is a nested JSON string
  JSON.stringify({ timestamp: '2026-10-20T02:00:06Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":["ls","-la"]}', call_id: 'c1' } }),
  // oversized output exercises the truncation path
  JSON.stringify({ timestamp: '2026-10-20T02:00:07Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'x'.repeat(20_000) } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:08Z', type: 'response_item', payload: { type: 'web_search_call', action: { type: 'search', query: 'vitest docs' } } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:09Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fixed' }] } }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:10Z', type: 'event_msg', payload: {} }),
  JSON.stringify({ timestamp: '2026-10-20T02:00:11Z', type: 'token_usage_record', payload: {} }),
].join('\n')

function parse() {
  return codexAdapter.parse({
    manifest,
    fetchFile: async () => new TextEncoder().encode(FIXTURE).buffer as ArrayBuffer,
    querySqlite: async () => { throw new Error('not used') },
  })
}

function toolPayload(parts: readonly { kind: string; payload?: unknown }[] | undefined, index: number): Record<string, unknown> {
  const part = parts?.[index]
  if (part?.kind !== 'tool-call')
    throw new Error(`expected tool-call at index ${index}`)
  return (part.payload ?? {}) as Record<string, unknown>
}

describe('codex adapter', () => {
  it('claims rollout files under sessions/YYYY/MM/DD', () => {
    expect(codexAdapter.detect(manifest)).toBe(true)
    expect(codexAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })

  it('maps the dialogue, merges outputs by call_id and drops duplicate streams', async () => {
    const source = await parse()
    expect(source.trajectories).toHaveLength(1)
    const trajectory = source.trajectories[0]!
    expect(trajectory.id).toBe('codex:00000000-0000-4000-8000-000000000000')
    expect(trajectory.title).toBe('fix the bug please')

    const nodes = [...trajectory.nodes.values()]
    expect(nodes).toHaveLength(3)
    const [user, step, reply] = nodes

    // the environment wrapper is filtered; the real prompt becomes the user node
    expect(user?.role).toBe('user')
    expect(user?.parts[0]?.kind === 'text' && user.parts[0].text).toBe('fix the bug please')

    // reasoning + tool call + web search merge into one assistant step
    expect(step?.model).toBe('gpt-5')
    expect(step?.parts.map(p => p.kind)).toEqual(['reasoning', 'tool-call', 'tool-call'])
    expect(toolPayload(step?.parts, 1)).toMatchObject({ title: 'ls -la', truncated: true, originalChars: 20_000 })
    expect((toolPayload(step?.parts, 1).output as string)).toHaveLength(2000)
    expect(toolPayload(step?.parts, 2)).toMatchObject({ title: 'vitest docs' })

    expect(reply?.parts[0]?.kind === 'text' && reply.parts[0].text).toBe('fixed')

    // event_msg / token_usage_record leave no trace
    expect(trajectory.nodes.size).toBe(3)
  })

  it('treats a filtered user turn as a boundary for assistant merging', async () => {
    const wrapped = [
      JSON.stringify({ timestamp: '2026-10-20T02:00:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } }),
      JSON.stringify({ timestamp: '2026-10-20T02:00:01Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'first' }] } }),
      JSON.stringify({ timestamp: '2026-10-20T02:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>y</environment_context>' }] } }),
      JSON.stringify({ timestamp: '2026-10-20T02:00:03Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"pwd"}', call_id: 'c2' } }),
    ].join('\n')
    const source = await codexAdapter.parse({
      manifest,
      fetchFile: async () => new TextEncoder().encode(wrapped).buffer as ArrayBuffer,
      querySqlite: async () => { throw new Error('not used') },
    })
    const nodes = [...source.trajectories[0]!.nodes.values()]
    // the dropped user turn still splits the flow: the tool call gets its own step
    expect(nodes.map(n => n.role)).toEqual(['assistant', 'assistant'])
    expect(nodes[0]?.parts[0]?.kind === 'text' && nodes[0].parts[0].text).toBe('first')
    expect(nodes[1]?.parts[0]?.kind).toBe('tool-call')
  })
})
