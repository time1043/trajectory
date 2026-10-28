import { describe, expect, it } from 'vitest'

import { fmtBytes, fmtChars, fmtDate, fmtInt, fmtLatency, fmtTime } from './format'

describe('fmtLatency', () => {
  it('formats seconds without overflow inside a minute', () => {
    expect(fmtLatency(500)).toBe('1s')
    expect(fmtLatency(59_400)).toBe('59s')
    expect(fmtLatency(59_500)).toBe('1m00s') // rounds up to the full minute
    expect(fmtLatency(125_400)).toBe('2m05s')
    // rolls into hours instead of printing 59m60s
    expect(fmtLatency(3_599_500)).toBe('1.0h')
    expect(fmtLatency(7_200_000)).toBe('2.0h')
  })
})

describe('fmtChars / fmtBytes', () => {
  it('rolls over unit boundaries instead of printing 1000.0k', () => {
    expect(fmtChars(823)).toBe('823')
    expect(fmtChars(12_431)).toBe('12.4k')
    expect(fmtChars(999_999)).toBe('1.0m')
    expect(fmtChars(1_243_000)).toBe('1.2m')

    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(1_048_575)).toBe('1.0 MB')
    expect(fmtBytes(2_097_152)).toBe('2.0 MB')
  })
})

describe('fmtDate / fmtTime / fmtInt', () => {
  it('zero-pads and groups thousands', () => {
    const at = new Date(2026, 0, 5, 3, 7).getTime()
    expect(fmtDate(at)).toBe('2026-01-05')
    expect(fmtTime(at)).toBe('03:07')
    expect(fmtInt(52000)).toBe('52,000')
  })
})
