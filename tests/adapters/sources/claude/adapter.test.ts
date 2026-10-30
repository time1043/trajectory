import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'

import { claudeAdapter } from '@/adapters/sources/claude/adapter'
import { parseJsonl } from '@/adapters/sources/local/common'

const SESSION_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const SESSION_B = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'

const T0 = '2026-10-30T09:00:00.000Z' // ai-title
const T1 = '2026-10-30T09:01:00.000Z' // user prompt
const T2 = '2026-10-30T09:02:00.000Z' // assistant thinking + tool_use
const T3 = '2026-10-30T09:03:00.000Z' // user tool_result (pure — no node)
const T4 = '2026-10-30T09:04:00.000Z' // assistant final text
const ms = (iso: string) => Date.parse(iso)

/** One session per file, exactly like ~/.claude/projects/<slug>/<uuid>.jsonl */
const SESSION_A_LINES = [
  { type: 'ai-title', timestamp: T0, aiTitle: 'Refactor parser exports' },
  {
    type: 'user',
    timestamp: T1,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: '<system-reminder>background task finished</system-reminder>' },
        { type: 'text', text: 'Help me refactor the parser module' },
      ],
    },
  },
  {
    type: 'assistant',
    timestamp: T2,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [
        { type: 'thinking', thinking: 'r'.repeat(10_000) },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/src/parser.ts' } },
      ],
    },
  },
  {
    type: 'user',
    timestamp: T3,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x'.repeat(20_000) }],
    },
  },
  {
    type: 'assistant',
    timestamp: T4,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'Done — the parser exports are clean.' }],
    },
  },
]

const SESSION_B_LINES = [
  {
    type: 'user',
    timestamp: '2026-10-30T10:00:00.000Z',
    message: { role: 'user', content: 'What is a monad?' },
  },
  {
    type: 'assistant',
    timestamp: '2026-10-30T10:01:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'A monad is a monoid in the category of endofunctors.' }],
    },
  },
]

function jsonl(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

const PATH_A = `local/claude/oswin-m4a/projects/-Users-oswin-dev/${SESSION_A}.jsonl`
const PATH_B = `local/claude/oswin-m4a/projects/-Users-oswin-dev/${SESSION_B}.jsonl`

const FILES: Record<string, string> = {
  [PATH_A]: jsonl(SESSION_A_LINES),
  [PATH_B]: jsonl(SESSION_B_LINES),
}

const manifest: SourceManifest = {
  dirName: 'local/claude-code/oswin-m4a',
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

describe('claude adapter (index/loadSession split)', () => {
  it('index: summaries per session file; tool-result lines count as neither messages nor turns', async () => {
    // fixture sanity: parseJsonl sees every line we wrote
    expect(parseJsonl(FILES[PATH_A]!)).toHaveLength(SESSION_A_LINES.length)

    const index = await claudeAdapter.index(input)
    expect(index.sourceId).toBe('claude-code:oswin-m4a')
    expect(index.providerLabel).toBe('Claude Code')
    expect(index.sessions).toHaveLength(2)

    const a = index.sessions.find((s) => s.sessionId === SESSION_A)!
    // 3 nodes (u, a, a) — the pure tool_result line at T3 is neither a message nor a turn
    expect(a.messageCount).toBe(3)
    expect(a.turnStarts).toEqual([ms(T1)])
    expect(a.title).toBe('Refactor parser exports') // ai-title wins
    expect(a.firstPrompt).toBe('Help me refactor the parser module') // system-reminder excluded
    expect(a.startedAt).toBe(ms(T0))
    expect(a.updatedAt).toBe(ms(T4))

    const b = index.sessions.find((s) => s.sessionId === SESSION_B)!
    expect(b.messageCount).toBe(2)
    expect(b.turnStarts).toHaveLength(1)
    expect(b.title).toBe('What is a monad?') // falls back to the prompt
    expect(b.firstPrompt).toBe('What is a monad?')
  })

  it('loadSession: full body — wrapped text dropped, reasoning capped, tool output truncated into the call', async () => {
    const trajectory = await claudeAdapter.loadSession(input, SESSION_A)
    expect(trajectory).not.toBeNull()
    expect(trajectory!.id).toBe(`claude-code:oswin-m4a:${SESSION_A}`)
    expect(trajectory!.title).toBe('Refactor parser exports')
    expect(trajectory!.startedAt).toBe(ms(T0))
    expect(trajectory!.updatedAt).toBe(ms(T4))

    const nodes = [...trajectory!.nodes.values()]
    expect(nodes.map((n) => n.role)).toEqual(['user', 'assistant', 'assistant'])

    expect(nodes[0]!.parts).toEqual([{ kind: 'text', text: 'Help me refactor the parser module' }])

    const [reasoning, tool] = nodes[1]!.parts
    expect(reasoning?.kind).toBe('reasoning')
    if (!reasoning || reasoning.kind !== 'reasoning') return
    expect(reasoning.text).toHaveLength(8000) // 10k -> REASONING_CAP_CHARS

    expect(tool?.kind).toBe('tool-call')
    if (!tool || tool.kind !== 'tool-call') return
    expect(tool.tool).toBe('Read')
    expect(tool.payload).toMatchObject({
      title: '/src/parser.ts',
      input: { file_path: '/src/parser.ts' },
      output: 'x'.repeat(2000), // 20k -> TOOL_OUTPUT_PREVIEW_CHARS
      truncated: true,
      originalChars: 20_000,
    })

    expect(nodes[2]!.parts).toEqual([
      { kind: 'text', text: 'Done — the parser exports are clean.' },
    ])
  })

  it('loadSession: prompt-fallback title; detect claims the manifest; unknown ids miss', async () => {
    const b = await claudeAdapter.loadSession(input, SESSION_B)
    expect(b).not.toBeNull()
    expect(b!.title).toBe('What is a monad?') // no ai-title in file B

    expect(
      await claudeAdapter.loadSession(input, 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
    ).toBeNull()

    expect(claudeAdapter.detect(manifest)).toBe(true)
    expect(claudeAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })
})
