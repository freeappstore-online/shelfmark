// Reading stats, derived from the library. Pure functions: no DOM, no
// IndexedDB, and "today" is always passed in, so they're easy to test.

import { addDays } from './dates'
import type { Book, ISODate, ProgressEntry } from './types'

/** "YYYY-MM" */
export type MonthKey = string

const monthOf = (date: ISODate): MonthKey => date.slice(0, 7)

/** Books on the Read shelf with a finish date. */
function finishedBooks(books: readonly Book[]): (Book & { finishedOn: ISODate })[] {
  return books.filter((b): b is Book & { finishedOn: ISODate } => b.status === 'read' && !!b.finishedOn)
}

/**
 * Consecutive days with reading logged, ending today, or yesterday if
 * nothing's logged yet today (the streak isn't broken until a day is missed).
 */
export function readingStreak(entries: readonly ProgressEntry[], today: ISODate): number {
  const days = new Set(entries.map((e) => e.date))
  let day = days.has(today) ? today : addDays(today, -1)
  let streak = 0
  while (days.has(day)) {
    streak++
    day = addDays(day, -1)
  }
  return streak
}

/** The longest run of consecutive days with reading logged, ever. */
export function longestStreak(entries: readonly ProgressEntry[]): number {
  const days = [...new Set(entries.map((e) => e.date))].sort()
  let longest = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && addDays(days[i - 1], 1) === days[i] ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return longest
}

/** Books finished per month, by finish date. Months with none are absent. */
export function booksPerMonth(books: readonly Book[]): Map<MonthKey, number> {
  const out = new Map<MonthKey, number>()
  for (const b of finishedBooks(books)) out.set(monthOf(b.finishedOn), (out.get(monthOf(b.finishedOn)) ?? 0) + 1)
  return out
}

/**
 * Pages read per month. Logged progress counts in the month it was logged; a
 * finished book's pages that were never logged (say, added straight to Read)
 * count in its finish month, so no page is counted twice.
 */
export function pagesPerMonth(books: readonly Book[], entries: readonly ProgressEntry[]): Map<MonthKey, number> {
  const out = new Map<MonthKey, number>()
  const add = (month: MonthKey, pages: number) => pages > 0 && out.set(month, (out.get(month) ?? 0) + pages)
  const loggedByBook = new Map<string, number>()
  for (const e of entries) {
    add(monthOf(e.date), e.pagesRead)
    loggedByBook.set(e.bookId, (loggedByBook.get(e.bookId) ?? 0) + e.pagesRead)
  }
  for (const b of finishedBooks(books)) {
    if (b.pages) add(monthOf(b.finishedOn), b.pages - (loggedByBook.get(b.id) ?? 0))
  }
  return out
}

/** The 12 months of a year, in order, with a value from `byMonth` (0 when missing). */
export function monthsOfYear(year: number, byMonth: ReadonlyMap<MonthKey, number>): { month: MonthKey; value: number }[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`
    return { month, value: byMonth.get(month) ?? 0 }
  })
}

export interface Ranked {
  name: string
  count: number
}

/** Counts names ignoring case and spacing, keeping the first spelling; most first, then A–Z. */
function rank(names: Iterable<string>, n: number): Ranked[] {
  const counts = new Map<string, Ranked>()
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) continue
    const key = name.toLocaleLowerCase()
    const hit = counts.get(key)
    if (hit) hit.count++
    else counts.set(key, { name, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n)
}

/** The most-read authors among `books` (pass the books to count, e.g. a year's finished books). */
export function topAuthors(books: readonly Book[], n = 5): Ranked[] {
  return rank(
    books.map((b) => b.author),
    n,
  )
}

/** The most-used tags among `books`. */
export function topTags(books: readonly Book[], n = 5): Ranked[] {
  return rank(
    books.flatMap((b) => b.tags),
    n,
  )
}

/** Books finished in a year. */
export function finishedIn(books: readonly Book[], year: number): Book[] {
  return finishedBooks(books).filter((b) => b.finishedOn.startsWith(`${year}-`))
}

export interface YearlyProgress {
  read: number
  goal: number
  /** read / goal, rounded; can pass 100. 0 without a goal. */
  percent: number
  /** Books you'd have read by today at an even pace; the whole goal for a past year, 0 for a future one. */
  expected: number
}

export function yearlyProgress(books: readonly Book[], goal: number | undefined, year: number, today: ISODate): YearlyProgress {
  const read = finishedIn(books, year).length
  const g = goal && goal > 0 ? goal : 0
  const thisYear = Number(today.slice(0, 4))
  let fraction = year < thisYear ? 1 : 0
  if (year === thisYear) {
    const start = Date.UTC(year, 0, 1)
    const days = (Date.UTC(year + 1, 0, 1) - start) / 86_400_000
    fraction = ((Date.parse(`${today}T00:00:00Z`) - start) / 86_400_000 + 1) / days
  }
  return { read, goal: g, percent: g ? Math.round((read / g) * 100) : 0, expected: Math.floor(g * fraction) }
}

/** How far into a book, 0–100: from the page when there's a page count, else the stored percent. */
export function bookPercent(book: Book): number | undefined {
  if (book.pages && book.currentPage !== undefined) return Math.min(100, Math.round((book.currentPage / book.pages) * 100))
  return book.percent
}
