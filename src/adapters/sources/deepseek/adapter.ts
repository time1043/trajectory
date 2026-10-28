import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter } from '@/domain/ports/source-adapter'
import { parseDeepseek } from './parse'

export const deepseekAdapter: SourceAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  detect(manifest: SourceManifest): boolean {
    return manifest.files.some(f => f.path.endsWith('conversations.json'))
  },
  async parse({ manifest, fetchFile }) {
    const files = new Map<string, ArrayBuffer>()
    for (const file of manifest.files)
      files.set(file.path, await fetchFile(file.path))
    return parseDeepseek(manifest, files)
  },
  piiHints: ['user.json#email', 'user.json#mobile'],
}
