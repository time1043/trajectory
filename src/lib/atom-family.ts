import { atom } from 'jotai'
import type { Atom } from 'jotai'

/**
 * jotai v3 移除了 atomFamily——这里补一个最小实现。
 * 本地 dev 工具的量级不需要 LRU/弱回收，Map 缓存即可；
 * atom 内部通过依赖 dataVersionAtom 实现失效，旧值交给 GC。
 */
export function atomFamily<Param, A extends Atom<unknown>>(create: (param: Param) => A): (param: Param) => A {
  const cache = new Map<Param, A>()
  return (param) => {
    let value = cache.get(param)
    if (!value) {
      value = create(param)
      cache.set(param, value)
    }
    return value
  }
}

export { atom }
