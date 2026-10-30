import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'

import { codexAdapter } from '@/adapters/sources/codex/adapter'
import { parseJsonl } from '@/adapters/sources/local/common'

const SESSION_A = 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f'
const SESSION_B = 'd4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f80'
const SESSION_C = 'e5f6a7b8-c9d0-4e1f-8a2b-4c5d6e7f8091'

const T0 = '2026-10-30T09:30:00.000Z' // session_meta
const T1 = '2026-10-30T09:30:01.000Z' // turn_context (model)
const T2 = '2026-10-30T09:30:02.000Z' // user message
const T3 = '2026-10-30T09:30:03.000Z' // reasoning
const T4 = '2026-10-30T09:30:04.000Z' // function_call
const T5 = '2026-10-30T09:30:05.000Z' // function_call_output
const T6 = '2026-10-30T09:30:06.000Z' // assistant message
const ms = (iso: string) => Date.parse(iso)

const SESSION_A_LINES = [
  { timestamp: T0, type: 'session_meta', payload: { cwd: '/Users/oswin/dev' } },
  { timestamp: T1, type: 'turn_context', payload: { model: 'gpt-5.1-codex' } },
  {
    timestamp: T2,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '<user_instructions>repo conventions here</user_instructions>',
        },
        { type: 'input_text', text: 'Why is this effect double-firing?' },
      ],
    },
  },
  {
    timestamp: T3,
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [
        { type: 'summary_text', text: 'Effects run twice under StrictMode in development.' },
      ],
    },
  },
  {
    timestamp: T4,
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'shell',
      call_id: 'call_7',
      arguments: JSON.stringify({ command: ['grep', '-rn', 'useEffect', 'src/'] }),
    },
  },
  {
    timestamp: T5,
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_7', output: 'y'.repeat(20_000) },
  },
  {
    timestamp: T6,
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'StrictMode double-invokes effects in development.' }],
    },
  },
]

const SESSION_B_LINES = [
  {
    timestamp: '2026-10-30T10:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'List the safe defaults' }],
    },
  },
  {
    timestamp: '2026-10-30T10:00:01.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'developer noise' }],
    },
  },
  {
    timestamp: '2026-10-30T10:00:02.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Done.' }],
    },
  },
]

/** Only injected context — no real user prompt, so no summary and no body */
const SESSION_C_LINES = [
  {
    timestamp: '2026-10-30T11:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context>sandbox</environment_context>' }],
    },
  },
]

function jsonl(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

const dir = 'local/codex/oswin-m4a/sessions/2026/10/30'
const FILES: Record<string, string> = {
  [`${dir}/rollout-2026-10-30T09-30-00-${SESSION_A}.jsonl`]: jsonl(SESSION_A_LINES),
  [`${dir}/rollout-2026-10-30T10-00-00-${SESSION_B}.jsonl`]: jsonl(SESSION_B_LINES),
  [`${dir}/rollout-2026-10-30T11-00-00-${SESSION_C}.jsonl`]: jsonl(SESSION_C_LINES),
}

const manifest: SourceManifest = {
  dirName: 'local/codex/oswin-m4a',
  files: Object.keys(FILES).map((path) => ({ path, size: 1, mtimeMs: 0 })),
}

const input = {
  manifest,
  fetchFile: async (path: string): Promise<ArrayBuffer> => {
    const text = FILES[path]
    if (text === undefined) throw new Error(`no fixture for ${path}`)
    return new TextEncoder().encode(text).buffer as ArrayBuffer
  },
  querySqlite: async (): Promise<never> => {
    throw new Error('sqlite not used by file adapters')
  },
}

describe('codex adapter (index/loadSession split)', () => {
  it('index: summaries per rollout file; injected context and developer role do not count', async () => {
    expect(
      parseJsonl(FILES[`${dir}/rollout-2026-10-30T09-30-00-${SESSION_A}.jsonl`]!),
    ).toHaveLength(SESSION_A_LINES.length)

    const index = await codexAdapter.index(input)
    expect(index.sourceId).toBe('codex:oswin-m4a')
    expect(index.providerLabel).toBe('Codex')
    // session C has no real user prompt -> no summary
    expect(index.sessions).toHaveLength(2)

    const a = index.sessions.find((s) => s.sessionId === SESSION_A)!
    expect(a.messageCount).toBe(2) // user + assistant; reasoning/tool items are not messages
    expect(a.turnStarts).toEqual([ms(T2)])
    expect(a.title).toBe('Why is this effect double-firing?')
    expect(a.firstPrompt).toBe('Why is this effect double-firing?')
    expect(a.startedAt).toBe(ms(T0)) // session_meta timestamp
    expect(a.updatedAt).toBe(ms(T6))

    const b = index.sessions.find((s) => s.sessionId === SESSION_B)!
    expect(b.messageCount).toBe(2) // developer role dropped
    expect(b.turnStarts).toEqual([ms('2026-10-30T10:00:00.000Z')])
    expect(b.title).toBe('List the safe defaults')
  })

  it('loadSession: reasoning/function_call attach to the assistant turn; argv arrays become tool titles', async () => {
    const trajectory = await codexAdapter.loadSession(input, SESSION_A)
    expect(trajectory).not.toBeNull()
    expect(trajectory!.id).toBe(`codex:oswin-m4a:${SESSION_A}`)
    expect(trajectory!.title).toBe('Why is this effect double-firing?')
    expect(trajectory!.startedAt).toBe(ms(T0))
    expect(trajectory!.updatedAt).toBe(ms(T6))

    const nodes = [...trajectory!.nodes.values()]
    expect(nodes.map((n) => n.role)).toEqual(['user', 'assistant', 'assistant'])

    expect(nodes[0]!.parts).toEqual([{ kind: 'text', text: 'Why is this effect double-firing?' }])

    const reasoningNode = nodes[1]!
    expect(reasoningNode.model).toBe('gpt-5.1-codex') // from turn_context
    expect(reasoningNode.parts.map((p) => p.kind)).toEqual(['reasoning', 'tool-call'])
    const tool = reasoningNode.parts[1]
    if (!tool || tool.kind !== 'tool-call') return
    expect(tool.tool).toBe('shell')
    expect(tool.payload).toMatchObject({
      title: 'grep -rn useEffect src/', // argv array joined
      output: 'y'.repeat(2000), // 20k -> TOOL_OUTPUT_PREVIEW_CHARS
      truncated: true,
      originalChars: 20_000,
    })

    expect(nodes[2]!.parts).toEqual([
      { kind: 'text', text: 'StrictMode double-invokes effects in development.' },
    ])
  })

  it('loadSession: context-only sessions yield null; detect claims the manifest', async () => {
    expect(await codexAdapter.loadSession(input, SESSION_C)).toBeNull()
    expect(await codexAdapter.loadSession(input, 'no-such-session')).toBeNull()

    expect(codexAdapter.detect(manifest)).toBe(true)
    expect(codexAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })
})
