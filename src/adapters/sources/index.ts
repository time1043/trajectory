// New source = new directory + one line here
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { claudeAdapter } from './claude/adapter'
import { codexAdapter } from './codex/adapter'
import { deepseekAdapter } from './deepseek/adapter'
import { opencodeAdapter } from './opencode/adapter'
import { piAdapter } from './pi/adapter'
import { zcodeAdapter } from './zcode/adapter'

export const sourceAdapters: readonly SourceAdapter[] = [
  deepseekAdapter,
  zcodeAdapter,
  opencodeAdapter,
  codexAdapter,
  piAdapter,
  claudeAdapter,
]
