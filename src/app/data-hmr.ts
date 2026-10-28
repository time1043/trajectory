import { getDefaultStore } from 'jotai'

import { DATA_API_HMR_EVENT } from '@/domain/ports/data-host'
import { dataVersionAtom } from './stores/data'

/** Data file changed on disk -> bump dataVersionAtom; downstream async atoms refetch */
export function setupDataHmr(): void {
  if (!import.meta.hot)
    return
  const store = getDefaultStore()
  import.meta.hot.on(DATA_API_HMR_EVENT, () => {
    store.set(dataVersionAtom, v => v + 1)
  })
}
