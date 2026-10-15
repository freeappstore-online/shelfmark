import type { ISODate } from './types'

/** The local calendar date of a timestamp, as YYYY-MM-DD. */
export function localDate(ms: number = Date.now()): ISODate {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The date `days` after (or before, if negative) an ISO date. Time-zone safe: works in UTC. */
export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
