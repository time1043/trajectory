export interface AttachmentRef {
  fileId: string
  fileName: string
  fileSize: number
}

export interface WebResult {
  url: string
  title: string
}

/** Structured payload for tool-call parts; adapters fill what they know */
export interface ToolCallPayload {
  title?: string
  input?: unknown
  output?: string
  truncated?: boolean
  originalChars?: number
  error?: string
}

/**
 * Role-agnostic content fragment (value object). Every foreign fragment kind
 * maps here; unrecognized ones land in the `unknown` bucket — never drop data
 * silently (fuse against export format drift).
 */
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'attachment'; files: readonly AttachmentRef[] }
  | { kind: 'search'; results: readonly WebResult[] }
  | { kind: 'tool-call'; tool: string; payload?: unknown }
  | { kind: 'unknown'; rawType: string }

/** Rough char count for lazy-render placeholders */
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
