import { atom } from 'jotai'
import { describe, expect, it } from 'vitest'

import { atomFamily } from './atom-family'

describe('atomFamily', () => {
  it('caches atoms per param and calls create once', () => {
    let created = 0
    const family = atomFamily((id: string) => {
      created++
      return atom(id)
    })
    const a = family('x')
    expect(family('x')).toBe(a)
    expect(created).toBe(1)
    expect(family('y')).not.toBe(a)
    expect(created).toBe(2)
  })

  it('distinguishes keys with SameValueZero semantics', () => {
    const family = atomFamily((n: number) => atom(n))
    expect(family(0)).toBe(family(0))
    expect(family(NaN)).toBe(family(NaN))
  })
})
