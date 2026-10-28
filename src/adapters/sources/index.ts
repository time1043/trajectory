import type { SourceAdapter } from '@/domain/ports/source-adapter'
import { deepseekAdapter } from './deepseek/adapter'

// 新来源 = 新建目录 + 下面加一行
export const sourceAdapters: readonly SourceAdapter[] = [
  deepseekAdapter,
]
