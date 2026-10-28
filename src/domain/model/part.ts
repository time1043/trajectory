export interface AttachmentRef {
  fileId: string
  fileName: string
  fileSize: number
}

export interface WebResult {
  url: string
  title: string
}

/**
 * Part — 角色无关的内容片段（值对象）。
 * 深层来源的 fragment 一律先映射到这里；未识别类型进 unknown 桶，
 * 禁止静默丢弃（导出格式漂移的保险丝）。
 */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'attachment'; files: readonly AttachmentRef[] }
  | { kind: 'search'; results: readonly WebResult[] }
  | { kind: 'tool-call'; tool: string; payload?: unknown }
  | { kind: 'unknown'; rawType: string }

export function partTextLength(part: Part): number {
  switch (part.kind) {
    case 'text':
    case 'reasoning':
      return part.text.length
    case 'attachment':
      return part.files.reduce((sum, f) => sum + f.fileName.length, 0)
    case 'search':
      return part.results.reduce((sum, r) => sum + r.url.length + r.title.length, 0)
    default:
      return 0
  }
}
