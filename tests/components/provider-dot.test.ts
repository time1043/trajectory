import { describe, expect, it } from 'vitest'

import { PROVIDER_COLORS, resolveProviderColor } from '@/components/provider-dot'

describe('resolveProviderColor', () => {
  it('resolves direct brand keys', () => {
    expect(resolveProviderColor('deepseek')).toBe(PROVIDER_COLORS.deepseek)
    expect(resolveProviderColor('claude')).toBe(PROVIDER_COLORS.claude)
    expect(resolveProviderColor('codex')).toBe(PROVIDER_COLORS.codex)
    expect(resolveProviderColor('opencode')).toBe(PROVIDER_COLORS.opencode)
    expect(resolveProviderColor('pi')).toBe(PROVIDER_COLORS.pi)
    expect(resolveProviderColor('zcode')).toBe(PROVIDER_COLORS.zcode)
    expect(resolveProviderColor('qwen')).toBe(PROVIDER_COLORS.qwen)
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveProviderColor('  Claude  ')).toBe(PROVIDER_COLORS.claude)
    expect(resolveProviderColor('DeepSeek')).toBe(PROVIDER_COLORS.deepseek)
    expect(resolveProviderColor('CODEX')).toBe(PROVIDER_COLORS.codex)
    expect(resolveProviderColor('OpenCode')).toBe(PROVIDER_COLORS.opencode)
    expect(resolveProviderColor('ZCode')).toBe(PROVIDER_COLORS.zcode)
  })

  it('resolves segmented paths and compound names', () => {
    expect(resolveProviderColor('web/qwen-166543499092823')).toBe(PROVIDER_COLORS.qwen)
    expect(resolveProviderColor('claude-oswin-m4a')).toBe(PROVIDER_COLORS.claude)
    expect(resolveProviderColor('local/opencode-oswin-m4a')).toBe(PROVIDER_COLORS.opencode)
  })

  it('resolves the provider:user identity shape', () => {
    expect(resolveProviderColor('deepseek:1665434994-qq')).toBe(PROVIDER_COLORS.deepseek)
    expect(resolveProviderColor('claude-code:oswin-m4a')).toBe(PROVIDER_COLORS.claude)
    expect(resolveProviderColor('zcode:oswin-m4a')).toBe(PROVIDER_COLORS.zcode)
    expect(resolveProviderColor('codex:oswin-m4a')).toBe(PROVIDER_COLORS.codex)
    expect(resolveProviderColor('opencode:oswin-m4a')).toBe(PROVIDER_COLORS.opencode)
    expect(resolveProviderColor('pi:oswin-m4a')).toBe(PROVIDER_COLORS.pi)
  })

  it('falls back to neutral grey for unknown sources', () => {
    expect(resolveProviderColor('unknown-custom-source')).toBe('#A3A3A3')
    expect(resolveProviderColor('')).toBe('#A3A3A3')
  })
})
