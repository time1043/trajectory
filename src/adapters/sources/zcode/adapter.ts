import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { parseOpencodeFamily } from '../local/opencode-family'

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
    return manifest.files.some((f) => f.path.endsWith('/db.sqlite'))
  },
  async parse({ manifest, querySqlite }) {
    const identity = sourceIdentity(manifest, 'zcode', 'ZCode')
    const dbPath = manifest.files.find((f) => f.path.endsWith('/db.sqlite'))!.path
    return parseOpencodeFamily({
      querySqlite,
      sourceId: identity.sourceId,
      label: identity.label,
      dbPath,
      dialect: {
        sessionsSql:
          'SELECT id, title, time_created, time_updated, parent_id, task_type, path FROM session WHERE time_deleted IS NULL ORDER BY time_updated DESC',
        messagesSql:
          'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created',
        partsSql:
          'SELECT message_id, sequence, data FROM part WHERE session_id = ? ORDER BY sequence',
        filterSession: (row) => row.task_type === 'subagent_child',
        skipMessage(data) {
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
        extraPart(data, unknownCounts) {
          // step envelopes and timeline separators are machinery, not dialogue
          if (data.type === 'step-start' || data.type === 'step-finish' || data.type === 'timeline')
            return null
          unknownCounts[String(data.type)] = (unknownCounts[String(data.type)] ?? 0) + 1
          return null
        },
      },
    })
  },
  piiHints: ['session.directory', 'message.data.contextSnapshot.envInfo'],
}
