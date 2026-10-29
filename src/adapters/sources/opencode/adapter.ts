import type { ToolCallPayload } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { toolPart } from '../local/common'
import { parseOpencodeFamily } from '../local/opencode-family'

/**
 * OpenCode CLI sessions (same schema family, no sequence columns). The db may
 * sit idle for months — still read it WAL-tolerantly. Default titles like
 * "New session - <ISO>" fall back to the first real user prompt.
 */
export const opencodeAdapter: SourceAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => f.path.endsWith('/opencode.db'))
  },
  async parse({ manifest, querySqlite }) {
    const dbPath = manifest.files.find((f) => f.path.endsWith('/opencode.db'))!.path
    return parseOpencodeFamily({
      querySqlite,
      sourceId: 'opencode',
      label: 'OpenCode',
      dbPath,
      dialect: {
        sessionsSql:
          'SELECT id, title, time_created, time_updated, parent_id, directory FROM session ORDER BY time_updated DESC',
        messagesSql:
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id',
        partsSql:
          'SELECT message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id',
        skipMessage: () => false,
        extraPart(data, unknownCounts) {
          if (
            data.type === 'step-start' ||
            data.type === 'step-finish' ||
            data.type === 'compaction'
          )
            return null
          // file-change events render as a tool call listing the touched files
          if (data.type === 'patch') {
            const files = Array.isArray(data.files) ? data.files : []
            const payload: ToolCallPayload = {
              title: `${files.length} file${files.length === 1 ? '' : 's'} changed`,
              input: files,
            }
            return toolPart('patch', payload)
          }
          unknownCounts[String(data.type)] = (unknownCounts[String(data.type)] ?? 0) + 1
          return null
        },
        normalizeTitle: (title) => (title.startsWith('New session - ') ? '' : title),
      },
    })
  },
  piiHints: ['session.directory'],
}
