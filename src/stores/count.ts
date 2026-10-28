import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

// primitive atoms
export const countAtom = atomWithStorage<number>('count', 0)
// derived atoms - read-only
export const doubleCountAtom = atom<number>((get) => get(countAtom) * 2)
