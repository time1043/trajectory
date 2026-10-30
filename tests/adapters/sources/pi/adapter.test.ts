import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'

import { parseJsonl } from '@/adapters/sources/local/common'
import { piAdapter } from '@/adapters/sources/pi/adapter'

const SESSION_A = 'e5f6a7b8-c9d0-4e1f-8a2b-4c5d6e7f8091'
const SESSION_B = 'f6a7b8c9-d0e1-4f2a-9b3c-5d6e7f809102'

const T1 = '2026-10-30T11:00:00.000Z'
const T2 = '2026-10-30T11:00:01.000Z'
const T3 = '2026-10-30T11:00:02.000Z'
const T4 = '2026-10-30T11:00:03.000Z'
const T5 = '2026-10-30T11:00:04.000Z'
const ms = (iso: string) => Date.parse(iso)

/** Pi lines carry both a line timestamp (ISO) and a message timestamp (epoch ms) */
const SESSION_A_LINES = [
  {
    type: 'message',
    timestamp: T1,
    message: {
      role: 'user',
      timestamp: ms(T1),
      content: [{ type: 'text', text: 'Explain the borrow checker' }],
    },
  },
  {
    type: 'message',
    timestamp: T2,
    message: {
      role: 'assistant',
      timestamp: ms(T2),
      model: 'kimi-k2',
      content: [
        { type: 'thinking', thinking: 't'.repeat(10_000) },
        { type: 'text', text: 'Ownership is enforced at compile time.' },
        {
          type: 'toolCall',
          id: 'call_9',
          name: 'Bash',
          arguments: { command: 'rustc --explain E0382' },
        },
      ],
    },
  },
  {
    type: 'message',
    timestamp: T3,
    message: {
      role: 'toolResult',
      timestamp: ms(T3),
      toolCallId: 'call_9',
      isError: false,
      content: [{ type: 'text', text: 'z'.repeat(20_000) }],
    },
  },
  {
    type: 'message',
    timestamp: T4,
    message: {
      role: 'assistant',
      timestamp: ms(T4),
      model: 'kimi-k2',
      content: [{ type: 'text', text: 'E0382 means use after move.' }],
    },
  },
  {
    type: 'message',
    timestamp: T5,
    message: {
      role: 'assistant',
      timestamp: ms(T5),
      stopReason: 'error',
      content: [{ type: 'text', text: 'API Error 500' }],
    },
  },
]

const SESSION_B_LINES = [
  {
    type: 'message',
    timestamp: '2026-10-30T12:00:00.000Z',
    message: {
      role: 'user',
      timestamp: ms('2026-10-30T12:00:00.000Z'),
      content: [{ type: 'text', text: 'What is property testing?' }],
    },
  },
  {
    type: 'message',
    timestamp: '2026-10-30T12:00:01.000Z',
    message: {
      role: 'assistant',
      timestamp: ms('2026-10-30T12:00:01.000Z'),
      content: [{ type: 'text', text: 'Generators plus shrinking.' }],
    },
  },
]

function jsonl(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

const dir = 'local/pi/oswin-m4a/sessions/2026-10-30'
const FILES: Record<string, string> = {
  [`${dir}/2026-10-30T11-00-00Z_${SESSION_A}.jsonl`]: jsonl(SESSION_A_LINES),
  [`${dir}/2026-10-30T12-00-00Z_${SESSION_B}.jsonl`]: jsonl(SESSION_B_LINES),
}

const manifest: SourceManifest = {
  dirName: 'local/pi/oswin-m4a',
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

describe('pi adapter (index/loadSession split)', () => {
  it('index: summaries per session file; toolResult and error messages do not count', async () => {
    expect(parseJsonl(FILES[`${dir}/2026-10-30T11-00-00Z_${SESSION_A}.jsonl`]!)).toHaveLength(
      SESSION_A_LINES.length,
    )

    const index = await piAdapter.index(input)
    expect(index.sourceId).toBe('pi:oswin-m4a')
    expect(index.providerLabel).toBe('Pi')
    expect(index.sessions).toHaveLength(2)

    const a = index.sessions.find((s) => s.sessionId === SESSION_A)!
    expect(a.messageCount).toBe(3) // user + 2 assistants; toolResult and stopReason:'error' excluded
    expect(a.turnStarts).toEqual([ms(T1)])
    expect(a.title).toBe('Explain the borrow checker')
    expect(a.firstPrompt).toBe('Explain the borrow checker')
    expect(a.startedAt).toBe(ms(T1))
    expect(a.updatedAt).toBe(ms(T5))

    const b = index.sessions.find((s) => s.sessionId === SESSION_B)!
    expect(b.messageCount).toBe(2)
    expect(b.turnStarts).toHaveLength(1)
    expect(b.title).toBe('What is property testing?')
  })

  it('loadSession: thinking/text/toolCall in one assistant node; toolResult output truncates into the call', async () => {
    const trajectory = await piAdapter.loadSession(input, SESSION_A)
    expect(trajectory).not.toBeNull()
    expect(trajectory!.id).toBe(`pi:oswin-m4a:${SESSION_A}`)
    expect(trajectory!.title).toBe('Explain the borrow checker')
    expect(trajectory!.startedAt).toBe(ms(T1))
    expect(trajectory!.updatedAt).toBe(ms(T5))

    const nodes = [...trajectory!.nodes.values()]
    expect(nodes.map((n) => n.role)).toEqual(['user', 'assistant', 'assistant'])

    expect(nodes[0]!.parts).toEqual([{ kind: 'text', text: 'Explain the borrow checker' }])

    const assistantNode = nodes[1]!
    expect(assistantNode.model).toBe('kimi-k2')
    expect(assistantNode.parts.map((p) => p.kind)).toEqual(['reasoning', 'text', 'tool-call'])
    const reasoning = assistantNode.parts[0]
    if (!reasoning || reasoning.kind !== 'reasoning') return
    expect(reasoning.text).toHaveLength(8000) // 10k -> REASONING_CAP_CHARS

    const tool = assistantNode.parts[2]
    if (!tool || tool.kind !== 'tool-call') return
    expect(tool.tool).toBe('Bash')
    expect(tool.payload).toMatchObject({
      title: 'rustc --explain E0382',
      output: 'z'.repeat(2000), // 20k -> TOOL_OUTPUT_PREVIEW_CHARS
      truncated: true,
      originalChars: 20_000,
    })

    expect(nodes[2]!.parts).toEqual([{ kind: 'text', text: 'E0382 means use after move.' }])
  })

  it('detect claims the manifest; unknown ids miss', async () => {
    expect(await piAdapter.loadSession(input, 'no-such-session')).toBeNull()

    expect(piAdapter.detect(manifest)).toBe(true)
    expect(piAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })
})
