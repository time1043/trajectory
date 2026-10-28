export function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export function fmtDate(at: number): string {
  const d = new Date(at)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fmtTime(at: number): string {
  const d = new Date(at)
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

/** 38s / 2m05s / 1.2h — rounded seconds, no 60s overflow inside a minute */
export function fmtLatency(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60)
    return `${totalSeconds}s`
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}m${`${seconds}`.padStart(2, '0')}s`
  }
  return `${(ms / 3_600_000).toFixed(1)}h`
}

/** 823 -> 823; 12431 -> 12.4k; 1243000 -> 1.2m (rolls over instead of 1000.0k) */
export function fmtChars(n: number): string {
  if (n < 999_950)
    return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

export function fmtBytes(n: number): string {
  if (n < 1024)
    return `${n} B`
  if (n < 1024 * 1023.95)
    return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export { MONTH_SHORT }
