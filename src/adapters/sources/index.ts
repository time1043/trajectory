// New source = new directory + one line here
import type { SourceAdapter } from '@/domain/ports/source-adapter'
import { deepseekAdapter } from './deepseek/adapter'

export const sourceAdapters: readonly SourceAdapter[] = [
  deepseekAdapter,
]
