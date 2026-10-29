import { describe, expect, it } from 'vitest'

import type { SourceManifest } from '@/domain/ports/data-host'

import { piAdapter } from '@/adapters/sources/pi/adapter'

const manifest: SourceManifest = {
  dirName: 'local/pi',
  files: [
    {
      path: 'local/pi/sessions/--Users-x-proj--/2026-08-21T01-02-03-000Z_00000000-0000-4000-8000-000000000000.jsonl',
      size: 1,
      mtimeMs: 0,
    },
  ],
}

const RAW_ID = '00000000-0000-4000-8000-000000000000'

const FIXTURE = [
  JSON.stringify({ type: 'session', id: 's1', timestamp: '2026-08-21T01:02:03Z', cwd: '/proj' }),
  JSON.stringify({
    type: 'model_change',
    timestamp: '2026-08-21T01:02:04Z',
    provider: 'x',
    modelId: 'kimi',
  }),
  JSON.stringify({
    type: 'message',
    timestamp: '2026-08-21T01:02:05Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '抽离 tray' }],
      timestamp: 1789717785918,
    },
  }),
  JSON.stringify({
    type: 'message',
    timestamp: '2026-08-21T01:02:06Z',
    message: {
      role: 'assistant',
      model: 'kimi-k2.7-code',
      stopReason: 'toolUse',
      timestamp: 1789717786600,
      content: [
        { type: 'thinking', thinking: 'plan the move' },
        {
          type: 'toolCall',
          id: 'functions.bash:0',
          name: 'bash',
          arguments: { command: 'ls main' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'message',
    timestamp: '2026-08-21T01:02:07Z',
    message: {
      role: 'toolResult',
      toolCallId: 'functions.bash:0',
      toolName: 'bash',
      isError: true,
      timestamp: 1789717787000,
      content: [
        { type: 'text', text: 'main.ts' },
        { type: 'image', data: 'iVBORw0' },
      ],
    },
  }),
  JSON.stringify({
    type: 'message',
    timestamp: '2026-08-21T01:02:08Z',
    message: {
      role: 'assistant',
      model: 'kimi-k2.7-code',
      stopReason: 'stop',
      timestamp: 1789717788000,
      content: [{ type: 'text', text: 'moved to menus/tray.ts' }],
    },
  }),
  JSON.stringify({
    type: 'message',
    timestamp: '2026-08-21T01:02:09Z',
    message: { role: 'system', content: '', sections: { preamble: 'you are...' } },
  }),
  JSON.stringify({ type: 'context_edit', timestamp: '2026-08-21T01:02:10Z' }),
].join('\n')

function toolPayload(
  parts: readonly { kind: string; payload?: unknown }[] | undefined,
  index: number,
): Record<string, unknown> {
  const part = parts?.[index]
  if (part?.kind !== 'tool-call') throw new Error(`expected tool-call at index ${index}`)
  return (part.payload ?? {}) as Record<string, unknown>
}

describe('pi adapter', () => {
  it('claims per-project session files', () => {
    expect(piAdapter.detect(manifest)).toBe(true)
    expect(piAdapter.detect({ dirName: 'x', files: [] })).toBe(false)
  })

  it('merges tool results into their tool calls and degrades images', async () => {
    const source = await piAdapter.parse({
      manifest,
      fetchFile: async () => new TextEncoder().encode(FIXTURE).buffer as ArrayBuffer,
      querySqlite: async () => {
        throw new Error('not used')
      },
    })
    expect(source.trajectories).toHaveLength(1)
    const trajectory = source.trajectories[0]!
    expect(trajectory.id).toBe(`pi:${RAW_ID}`)
    expect(trajectory.title).toBe('抽离 tray')

    const nodes = [...trajectory.nodes.values()]
    // system and model_change lines leave no trace; the failed-turn filter is not hit here
    expect(nodes).toHaveLength(3)
    const [user, step, reply] = nodes
    expect(user?.parts[0]?.kind === 'text' && user.parts[0].text).toBe('抽离 tray')

    expect(step?.model).toBe('kimi-k2.7-code')
    expect(step?.parts.map((p) => p.kind)).toEqual(['reasoning', 'tool-call', 'attachment'])
    expect(toolPayload(step?.parts, 1)).toMatchObject({
      title: 'ls main',
      output: 'main.ts',
      error: 'error',
    })
    const image = step?.parts[2]
    expect(image?.kind === 'attachment' && image.files[0]).toMatchObject({
      fileName: 'image',
      fileSize: 7,
    })

    expect(reply?.parts[0]?.kind === 'text' && reply.parts[0].text).toBe('moved to menus/tray.ts')
  })
})
