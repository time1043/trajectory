import type { ToolCallPayload } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { toolPart } from '../local/common'
import { indexOpencodeFamily, loadOpencodeFamilySession } from '../local/opencode-family'

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
  async index({ manifest, querySqlite }) {
    const identity = sourceIdentity(manifest, 'opencode', 'OpenCode')
    const dbPath = manifest.files.find((f) => f.path.endsWith('/opencode.db'))!.path
    return indexOpencodeFamily({
      querySqlite,
      identity,
      dbPath,
      dialect: {
        sessionsSql:
          'SELECT id, title, time_created, time_updated, parent_id, directory FROM session ORDER BY time_updated DESC',
        skeletonSql:
          "SELECT m.session_id AS sid, json_extract(m.data, '$.role') AS role, NULL AS kind, NULL AS origin, NULL AS vis, m.time_created AS at FROM message m ORDER BY m.time_created, m.id",
        firstPromptSql:
          "SELECT session_id, txt FROM (SELECT m.session_id AS session_id, substr(json_extract(p.data, '$.text'), 1, 240) AS txt, ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.time_created, p.time_created) AS rn FROM message m JOIN part p ON p.message_id = m.id WHERE json_extract(m.data, '$.role') = 'user' AND json_extract(p.data, '$.type') = 'text' AND json_extract(p.data, '$.synthetic') IS NOT 1) WHERE rn = 1",
        sessionByIdSql: 'SELECT id, title, time_created, time_updated FROM session WHERE id = ?',
        messagesSql:
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id',
        partsSql:
          'SELECT message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id',
        skipSkeleton: () => false,
        skipMessageData: () => false,
        extraPart(data) {
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
          return { kind: 'unknown', rawType: String(data.type) }
        },
        normalizeTitle: (title) => (title.startsWith('New session - ') ? '' : title),
      },
    })
  },
  async loadSession({ manifest, querySqlite }, sessionId) {
    const identity = sourceIdentity(manifest, 'opencode', 'OpenCode')
    const dbPath = manifest.files.find((f) => f.path.endsWith('/opencode.db'))!.path
    return loadOpencodeFamilySession({
      querySqlite,
      identity,
      dbPath,
      sessionId,
      dialect: {
        sessionsSql: '',
        skeletonSql: '',
        firstPromptSql: '',
        sessionByIdSql: 'SELECT id, title, time_created, time_updated FROM session WHERE id = ?',
        messagesSql:
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id',
        partsSql:
          'SELECT message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id',
        skipSkeleton: () => false,
        skipMessageData: () => false,
        extraPart(data) {
          if (
            data.type === 'step-start' ||
            data.type === 'step-finish' ||
            data.type === 'compaction'
          )
            return null
          if (data.type === 'patch') {
            const files = Array.isArray(data.files) ? data.files : []
            const payload: ToolCallPayload = {
              title: `${files.length} file${files.length === 1 ? '' : 's'} changed`,
              input: files,
            }
            return toolPart('patch', payload)
          }
          return { kind: 'unknown', rawType: String(data.type) }
        },
        normalizeTitle: (title) => (title.startsWith('New session - ') ? '' : title),
      },
    })
  },
  piiHints: ['session.directory'],
}
