import { getDefaultStore } from 'jotai'

import { DATA_API_HMR_EVENT } from '@/domain/ports/data-host'

import { dataVersionAtom, sourceIndexFamily } from './stores/data'

/** Payload sent by plugins/trajectory-data.ts — dirNames touched in one debounce window */
interface DataApiHmrPayload {
  dirNames?: readonly string[]
}

/**
 * Data file changed on disk -> bump dataVersionAtom once (manifest refetch) and
 * reload each touched source's index. sourceIndexFamily compares a file
 * fingerprint, so untouched sources return their last result instead of
 * re-ingesting; downstream async atoms refetch automatically.
 */
export function setupDataHmr(): void {
  if (!import.meta.hot) return
  const store = getDefaultStore()
  import.meta.hot.on(DATA_API_HMR_EVENT, (payload) => {
    // bump first so the per-source reloads below read the fresh manifest
    store.set(dataVersionAtom, (v) => v + 1)
    const dirNames = (payload as DataApiHmrPayload | null)?.dirNames ?? []
    for (const dirName of dirNames) {
      // eagerly reload the touched sources even when no component is mounted on
      // them yet; errors surface through the mounted consumers instead
      store.get(sourceIndexFamily(dirName)).catch(() => {})
    }
  })
}
