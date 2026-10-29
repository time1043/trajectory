import type { Atom } from 'jotai'

/**
 * jotai v3 removed atomFamily — minimal replacement. A local dev tool at this
 * scale needs no LRU/eviction, so a Map cache suffices; invalidation goes
 * through the dataVersionAtom dependency inside each atom.
 */
export function atomFamily<Param, A extends Atom<unknown>>(
  create: (param: Param) => A,
): (param: Param) => A {
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
