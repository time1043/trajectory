import { getDefaultStore, useSetAtom } from 'jotai'

import { DATA_API_HMR_EVENT } from '@/domain/ports/data-host'
import { dataVersionAtom } from './stores/data'

/** dev 期数据文件变化 → bump dataVersionAtom，下游 async atom 全部重算 */
export function setupDataHmr(): void {
  if (!import.meta.hot)
    return
  const store = getDefaultStore()
  import.meta.hot.on(DATA_API_HMR_EVENT, () => {
    store.set(dataVersionAtom, v => v + 1)
  })
}

/** 供 UI 使用的手动刷新（错误态重试等） */
export function useRefreshData() {
  return useSetAtom(dataVersionAtom)
}
