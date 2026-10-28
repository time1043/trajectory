import type { SourceFileEntry, SourceManifest } from './data-host'
import type { ParsedSource } from '../model/trajectory'

export type { SourceFileEntry, SourceManifest }

/**
 * SourceAdapter — 外部数据源的插件契约。
 * 实现必须是同构纯函数：不 import react/jotai/vite/node API，
 * 只通过 fetchFile 取字节。新来源 = 新增目录 + registry 加一行。
 */
export interface SourceAdapter {
  readonly id: string
  readonly label: string
  /** manifest 判定是否本适配器的地盘（如存在 conversations.json） */
  detect(manifest: SourceManifest): boolean
  parse(input: SourceParseInput): Promise<ParsedSource>
  /** 来源特有 PII 字段提示，供未来脱敏器参考 */
  readonly piiHints?: readonly string[]
}

export interface SourceParseInput {
  manifest: SourceManifest
  fetchFile(path: string): Promise<ArrayBuffer>
}
