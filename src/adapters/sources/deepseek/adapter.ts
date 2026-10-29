import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { indexDeepseek, loadDeepseekSession } from './parse'

export const deepseekAdapter: SourceAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some((f) => f.path.endsWith('conversations.json'))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'deepseek', 'DeepSeek')
    const files = new Map<string, ArrayBuffer>()
    for (const file of manifest.files) files.set(file.path, await fetchFile(file.path))
    return indexDeepseek(manifest, files, identity)
  },
  async loadSession({ manifest, fetchFile }, sessionId) {
    const identity = sourceIdentity(manifest, 'deepseek', 'DeepSeek')
    const files = new Map<string, ArrayBuffer>()
    for (const file of manifest.files) files.set(file.path, await fetchFile(file.path))
    return loadDeepseekSession(manifest, files, sessionId, identity)
  },
  piiHints: ['user.json#email', 'user.json#mobile'],
}
