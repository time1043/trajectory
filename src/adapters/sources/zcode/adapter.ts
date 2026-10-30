import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { indexOpencodeFamily, loadOpencodeFamilySession } from '../local/opencode-family'

/**
 * ZCode CLI sessions (opencode-family schema superset, actively written).
 * `sequence` columns give deterministic ordering; `semantics` separates the
 * user's real prompts from agent-injected noise, and half the sessions are
 * subagent machinery that must not flood the list.
 */
export const zcodeAdapter: SourceAdapter = {
  id: 'zcode',
  label: 'ZCode',
  detect(manifest: SourceManifest): boolean {
    if (!manifest.dirName.includes('zcode')) return false
    return manifest.files.some((f) => f.path.endsWith('/db.sqlite'))
  },
  async index({ manifest, querySqlite }) {
    const identity = sourceIdentity(manifest, 'zcode', 'ZCode')
    const dbPath = manifest.files.find((f) => f.path.endsWith('/db.sqlite'))!.path
    return indexOpencodeFamily({
      querySqlite,
      identity,
      dbPath,
      dialect: {
        sessionsSql:
          'SELECT id, title, time_created, time_updated, parent_id, task_type, path FROM session WHERE time_deleted IS NULL ORDER BY time_updated DESC',
        skeletonSql:
          "SELECT m.session_id AS sid, json_extract(m.data, '$.role') AS role, json_extract(m.data, '$.semantics.kind') AS kind, json_extract(m.data, '$.semantics.origin') AS origin, json_extract(m.data, '$.semantics.uiVisibility') AS vis, m.time_created AS at FROM message m JOIN session s ON s.id = m.session_id WHERE s.time_deleted IS NULL AND (s.task_type IS NULL OR s.task_type <> 'subagent_child') ORDER BY m.session_id, m.sequence, m.time_created",
        firstPromptSql:
          "SELECT session_id, txt FROM (SELECT m.session_id AS session_id, substr(json_extract(p.data, '$.text'), 1, 240) AS txt, ROW_NUMBER() OVER (PARTITION BY m.session_id ORDER BY m.sequence) AS rn FROM message m JOIN part p ON p.message_id = m.id WHERE json_extract(m.data, '$.role') = 'user' AND json_extract(m.data, '$.semantics.kind') = 'user_prompt' AND json_extract(m.data, '$.semantics.origin') = 'real_user' AND json_extract(m.data, '$.semantics.uiVisibility') = 'visible' AND json_extract(p.data, '$.type') = 'text' AND json_extract(p.data, '$.synthetic') IS NOT 1) WHERE rn = 1",
        sessionByIdSql: 'SELECT id, title, time_created, time_updated FROM session WHERE id = ?',
        messagesSql:
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created',
        partsSql:
          'SELECT message_id, sequence, data FROM part WHERE session_id = ? ORDER BY sequence',
        skipSkeleton(skel) {
          // user: only real prompts; assistant: visible responses
          if (skel.role === 'user')
            return !(
              skel.kind === 'user_prompt' &&
              skel.origin === 'real_user' &&
              skel.vis === 'visible'
            )
          return skel.vis === 'hidden' || skel.kind === 'timeline_event'
        },
        skipMessageData(data) {
          const semantics = (data.semantics ?? {}) as Record<string, unknown>
          if (data.role === 'user') {
            return !(
              semantics.kind === 'user_prompt' &&
              semantics.origin === 'real_user' &&
              semantics.uiVisibility === 'visible'
            )
          }
          return semantics.uiVisibility === 'hidden' || semantics.kind === 'timeline_event'
        },
        extraPart(data) {
          // step envelopes and timeline separators are machinery, not dialogue
          if (data.type === 'step-start' || data.type === 'step-finish' || data.type === 'timeline')
            return null
          return { kind: 'unknown', rawType: String(data.type) }
        },
      },
    })
  },
  async loadSession({ manifest, querySqlite }, sessionId) {
    const identity = sourceIdentity(manifest, 'zcode', 'ZCode')
    const dbPath = manifest.files.find((f) => f.path.endsWith('/db.sqlite'))!.path
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
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created',
        partsSql:
          'SELECT message_id, sequence, data FROM part WHERE session_id = ? ORDER BY sequence',
        skipSkeleton: () => false,
        skipMessageData(data) {
          const semantics = (data.semantics ?? {}) as Record<string, unknown>
          if (data.role === 'user') {
            return !(
              semantics.kind === 'user_prompt' &&
              semantics.origin === 'real_user' &&
              semantics.uiVisibility === 'visible'
            )
          }
          return semantics.uiVisibility === 'hidden' || semantics.kind === 'timeline_event'
        },
        extraPart(data) {
          if (data.type === 'step-start' || data.type === 'step-finish' || data.type === 'timeline')
            return null
          return { kind: 'unknown', rawType: String(data.type) }
        },
      },
    })
  },
  piiHints: ['session.directory', 'message.data.contextSnapshot.envInfo'],
}
