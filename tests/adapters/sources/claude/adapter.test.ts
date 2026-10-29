import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'

import { claudeAdapter } from '@/adapters/sources/claude/adapter'

const manifest: SourceManifest = {
  dirName: 'local/claude-code/oswin-m4a',
  files: [
    {
      path: 'local/claude/projects/-Users-x-proj/00000000-0000-4000-8000-000000000000.jsonl',
      size: 1,
      mtimeMs: 0,
    },
    // sibling overflow directories must not be claimed as sessions
    {
      path: 'local/claude/projects/-Users-x-proj/00000000-0000-4000-8000-000000000000/tool-results/a.txt',
      size: 1,
      mtimeMs: 0,
    },
    { path: 'local/claude/projects/-Users-x-proj/memory/MEMORY.md', size: 1, mtimeMs: 0 },
  ],
}

const FIXTURE = [
  JSON.stringify({
    type: 'ai-title',
    aiTitle: 'Fix the widget',
    timestamp: '2026-10-14T01:00:00Z',
  }),
  JSON.stringify({ type: 'api-request-blob', timestamp: '2026-10-14T01:00:01Z', payload: {} }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-10-14T01:00:02Z',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: '<ide_opened_file>src/x.ts</ide_opened_file>' },
        { type: 'text', text: 'add distractors to the json' },
      ],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-14T01:00:03Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      content: [
        { type: 'thinking', thinking: 'inspect files' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'Bash',
          input: { command: 'ls -la', description: 'List files' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-10-14T01:00:04Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: `total 1072\n${'y'.repeat(20_000)}`,
          is_error: false,
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    timestamp: '2026-10-14T01:00:05Z',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-14T01:00:06Z',
    message: {
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text: 'api error' }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-14T01:00:07Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'done' }],
    },
  }),
  JSON.stringify({ type: 'file-history-snapshot', timestamp: '2026-10-14T01:00:08Z' }),
  JSON.stringify({ type: 'system', subtype: 'api_error', timestamp: '2026-10-14T01:00:09Z' }),
].join('\n')

function toolPayload(
  parts: readonly { kind: string; payload?: unknown }[] | undefined,
  index: number,
): Record<string, unknown> {
  const part = parts?.[index]
  if (part?.kind !== 'tool-call') throw new Error(`expected tool-call at index ${index}`)
  return (part.payload ?? {}) as Record<string, unknown>
}

describe('claude adapter', () => {
  it('claims only session files directly under projects/<slug>', () => {
    expect(claudeAdapter.detect(manifest)).toBe(true)
    expect(claudeAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })

  it('applies the line whitelist and merges tool results by tool_use id', async () => {
    const source = await claudeAdapter.parse({
      manifest,
      fetchFile: async (path) =>
        new TextEncoder().encode(
          path.includes('00000000-0000-4000-8000-000000000000.jsonl') ? FIXTURE : '',
        ).buffer as ArrayBuffer,
      querySqlite: async () => {
        throw new Error('not used')
      },
    })
    expect(source.trajectories).toHaveLength(1)
    const trajectory = source.trajectories[0]!
    expect(trajectory.title).toBe('Fix the widget') // ai-title wins over the prompt fallback

    const nodes = [...trajectory.nodes.values()]
    // user -> assistant step -> image-only user -> assistant; synthetic error line dropped
    expect(nodes).toHaveLength(4)
    const [user, step, imageOnly, reply] = nodes

    expect(user?.parts[0]?.kind === 'text' && user.parts[0].text).toBe(
      'add distractors to the json',
    )

    expect(step?.parts.map((p) => p.kind)).toEqual(['reasoning', 'tool-call'])
    expect(toolPayload(step?.parts, 1)).toMatchObject({
      title: 'ls -la',
      truncated: true,
      originalChars: 20_011,
    })
    expect(toolPayload(step?.parts, 1).output as string).toHaveLength(2000)

    // image-only user turns keep their attachment instead of vanishing
    expect(imageOnly?.parts[0]?.kind).toBe('attachment')

    expect(reply?.parts[0]?.kind === 'text' && reply.parts[0].text).toBe('done')
  })

  it('falls back to the first real prompt when no ai-title exists', async () => {
    const noTitle = FIXTURE.replace(/^\{.*"ai-title".*\}\n/, '')
    const source = await claudeAdapter.parse({
      manifest,
      fetchFile: async () => new TextEncoder().encode(noTitle).buffer as ArrayBuffer,
      querySqlite: async () => {
        throw new Error('not used')
      },
    })
    expect(source.trajectories[0]?.title).toBe('add distractors to the json')
  })
})
