// New source = new directory + one line here
import type { SourceAdapter } from '@/domain/ports/source-adapter'
import { deepseekAdapter } from './deepseek/adapter'
import { zcodeAdapter } from './zcode/adapter'
import { opencodeAdapter } from './opencode/adapter'
import { codexAdapter } from './codex/adapter'
import { piAdapter } from './pi/adapter'
import { claudeAdapter } from './claude/adapter'

export const sourceAdapters: readonly SourceAdapter[] = [
  deepseekAdapter,
  zcodeAdapter,
  opencodeAdapter,
  codexAdapter,
  piAdapter,
  claudeAdapter,
]
