import { describe, expect, it } from 'vitest'

import type { RawConversation } from '@/adapters/sources/deepseek/types'
import type { SourceManifest } from '@/domain/ports/data-host'

import { parseDeepseek } from '@/adapters/sources/deepseek/parse'
import { sourceIdentity } from '@/domain/ports/source-adapter'

const manifest: SourceManifest = {
  dirName: 'web/deepseek/1665434994-qq',
  files: [
    { path: 'web/deepseek/1665434994-qq/conversations.json', size: 1, mtimeMs: 0 },
    { path: 'web/deepseek/1665434994-qq/user.json', size: 1, mtimeMs: 0 },
  ],
}

function encode(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer
}

const conversation: RawConversation = {
  id: 'c1',
  title: '',
  inserted_at: '2026-01-01T00:00:00+08:00',
  updated_at: '2026-01-01T01:00:00+08:00',
  mapping: {
    root: { id: 'root', parent: null, children: ['1'], message: null },
    '1': {
      id: '1',
      parent: 'root',
      children: ['2', '4'],
      message: {
        model: 'deepseek-chat',
        inserted_at: '2026-01-01T00:01:00+08:00',
        fragments: [
          { type: 'REQUEST', content: 'question' },
          { type: 'FILE', files: [{ file_id: 'f0', file_name: 'prompt.txt', file_size: 3 }] },
        ],
      },
    },
    '2': {
      id: '2',
      parent: '1',
      children: [],
      message: {
        model: 'deepseek-chat',
        inserted_at: '2026-01-01T00:02:00+08:00',
        fragments: [{ type: 'RESPONSE', content: 'v1' }],
      },
    },
    '3': {
      id: '3',
      parent: '1',
      children: [],
      message: {
        model: 'deepseek-chat',
        inserted_at: '2026-01-01T00:02:30+08:00',
        fragments: [{ type: 'RESPONSE', content: 'v2' }],
      },
    },
    '4': {
      id: '4',
      parent: '1',
      children: [],
      message: {
        model: 'deepseek-reasoner',
        inserted_at: '2026-01-01T00:03:00+08:00',
        fragments: [
          { type: 'THINK', content: 'chain of thought' },
          { type: 'SEARCH', results: [{ url: 'https://x/1', title: 'X' }] },
          { type: 'TOOL_OPEN' },
          { type: 'WEIRD', content: '?' },
          { type: 'RESPONSE', content: 'v3' },
        ],
      },
    },
  },
}

const user = {
  user_id: 'u-12345678',
  email: 'someone@example.com',
  mobile: { mobile_number: '13800001111', area_code: '+86' },
  oauth_profiles: [
    { provider: 'WECHAT', profile_json: JSON.stringify({ provider: 'WECHAT', name: 'tester' }) },
  ],
}

function parse() {
  return parseDeepseek(
    manifest,
    new Map([
      ['web/deepseek/1665434994-qq/conversations.json', encode([conversation])],
      ['web/deepseek/1665434994-qq/user.json', encode(user)],
    ]),
    sourceIdentity(manifest, 'deepseek', 'DeepSeek'),
  )
}

describe('parseDeepseek', () => {
  it('erases the root sentinel and normalizes child order by time', () => {
    const source = parse()
    const trajectory = source.trajectories[0]!
    const node1 = trajectory.nodes.get('1')!
    expect(node1.parentId).toBeNull()
    // children [2, 4] already ascending; the export's raw order is normalized
    expect(node1.childIds).toEqual(['2', '4'])
  })

  it('infers roles from fragment kinds', () => {
    const source = parse()
    expect(source.trajectories[0]?.nodes.get('1')?.role).toBe('user')
    expect(source.trajectories[0]?.nodes.get('4')?.role).toBe('assistant')
  })

  it('maps fragments to parts and counts unknown kinds', () => {
    const source = parse()
    expect(source.trajectories[0]?.nodes.get('1')!.parts.map((p) => p.kind)).toEqual([
      'text',
      'attachment',
    ])
    const parts = source.trajectories[0]?.nodes.get('4')!.parts ?? []
    expect(parts.map((p) => p.kind)).toEqual([
      'reasoning',
      'search',
      'tool-call',
      'unknown',
      'text',
    ])
    expect(source.diagnostics.unknownPartCounts).toEqual({ WEIRD: 1 })
  })

  it('follows the last-child active path with the full subtree intact', () => {
    const source = parse()
    const trajectory = source.trajectories[0]!
    expect(trajectory.activePath).toEqual(['1', '4'])
    expect(trajectory.nodes.size).toBe(4) // variant '2' and '3' stay reachable
  })

  it('falls back to (untitled) and masks profile PII', () => {
    const source = parse()
    expect(source.trajectories[0]?.id).toBe('deepseek:1665434994-qq:c1')
    expect(source.providerLabel).toBe('DeepSeek')
    expect(source.user).toBe('1665434994-qq')
    expect(source.trajectories[0]?.title).toBe('(untitled)')
    expect(source.profile).toEqual({
      displayName: 'tester',
      identifiers: ['som****@example.com', '138****111'],
    })
  })

  it('tolerates a missing or broken user.json', () => {
    const withoutUser = parseDeepseek(
      manifest,
      new Map([['web/deepseek/1665434994-qq/conversations.json', encode([conversation])]]),
      sourceIdentity(manifest, 'deepseek', 'DeepSeek'),
    )
    expect(withoutUser.profile).toBeNull()

    const brokenUser = parseDeepseek(
      manifest,
      new Map([
        ['web/deepseek/1665434994-qq/conversations.json', encode([conversation])],
        ['web/deepseek/1665434994-qq/user.json', encode({ broken: true })],
      ]),
      sourceIdentity(manifest, 'deepseek', 'DeepSeek'),
    )
    // a user record without the expected fields degrades instead of crashing the source
    expect(brokenUser.profile).toEqual({ displayName: 'unknown', identifiers: [] })
  })

  it('requires conversations.json in the manifest', () => {
    const empty: SourceManifest = { dirName: 'web/deepseek/1665434994-qq', files: [] }
    expect(() =>
      parseDeepseek(empty, new Map(), sourceIdentity(empty, 'deepseek', 'DeepSeek')),
    ).toThrow(/conversations\.json/)
  })
})
