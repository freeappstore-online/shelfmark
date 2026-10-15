import { describe, expect, it } from 'vitest'
import {
  bookPercent,
  booksPerMonth,
  finishedIn,
  longestStreak,
  monthsOfYear,
  pagesPerMonth,
  readingStreak,
  topAuthors,
  topTags,
  yearlyProgress,
} from './stats'
import type { Book, ProgressEntry } from './types'

let seq = 0
function book(fields: Partial<Book>): Book {
  return {
    id: `b${++seq}`,
    title: 'T',
    author: '',
    status: 'want',
    shelves: [],
    notes: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  }
}
const entry = (date: string, pagesRead = 10, bookId = 'b'): ProgressEntry => ({
  id: `${bookId}:${date}`,
  bookId,
  date,
  pagesRead,
  updatedAt: 0,
})

describe('readingStreak', () => {
  it('is 0 with no reading, or when the last reading was before yesterday', () => {
    expect(readingStreak([], '2026-10-16')).toBe(0)
    expect(readingStreak([entry('2026-10-14')], '2026-10-16')).toBe(0)
  })

  it('is 1 for reading only today, or only yesterday (not broken until a day is missed)', () => {
    expect(readingStreak([entry('2026-10-16')], '2026-10-16')).toBe(1)
    expect(readingStreak([entry('2026-10-15')], '2026-10-16')).toBe(1)
  })

  it('counts N consecutive days, with several entries per day counted once', () => {
    const entries = [
      entry('2026-10-13'),
      entry('2026-10-14'),
      entry('2026-10-15', 5, 'a'),
      entry('2026-10-15', 5, 'b'),
      entry('2026-10-16'),
    ]
    expect(readingStreak(entries, '2026-10-16')).toBe(4)
  })

  it('stops at a gap', () => {
    const entries = [entry('2026-10-10'), entry('2026-10-11'), entry('2026-10-13'), entry('2026-10-14'), entry('2026-10-15')]
    expect(readingStreak(entries, '2026-10-15')).toBe(3)
    expect(readingStreak(entries, '2026-10-11')).toBe(2)
  })

  it('crosses month, year and leap-day boundaries', () => {
    expect(readingStreak([entry('2025-12-31'), entry('2026-01-01')], '2026-01-01')).toBe(2)
    expect(readingStreak([entry('2028-02-28'), entry('2028-02-29'), entry('2028-03-01')], '2028-03-01')).toBe(3)
    expect(readingStreak([entry('2026-02-28'), entry('2026-03-01')], '2026-03-01')).toBe(2)
  })

  it('ignores entry order', () => {
    expect(readingStreak([entry('2026-10-16'), entry('2026-10-14'), entry('2026-10-15')], '2026-10-16')).toBe(3)
  })
})

describe('longestStreak', () => {
  it('finds the longest run anywhere in the log', () => {
    expect(longestStreak([])).toBe(0)
    const entries = [entry('2026-01-01'), entry('2026-01-02'), entry('2026-01-03'), entry('2026-02-10'), entry('2026-02-11')]
    expect(longestStreak(entries)).toBe(3)
    expect(longestStreak([entry('2026-05-05'), entry('2026-05-05', 1, 'x')])).toBe(1)
  })
})

describe('booksPerMonth', () => {
  it('counts Read books by finish month, ignoring other shelves and undated ones', () => {
    const books = [
      book({ status: 'read', finishedOn: '2026-01-05' }),
      book({ status: 'read', finishedOn: '2026-01-31' }),
      book({ status: 'read', finishedOn: '2026-03-01' }),
      book({ status: 'read', finishedOn: '2025-03-01' }),
      book({ status: 'read' }),
      book({ status: 'reading', finishedOn: '2026-01-10' }),
    ]
    expect(Object.fromEntries(booksPerMonth(books))).toEqual({ '2026-01': 2, '2026-03': 1, '2025-03': 1 })
  })
})

describe('pagesPerMonth', () => {
  it('sums logged pages by month', () => {
    const entries = [entry('2026-01-30', 40), entry('2026-01-31', 60), entry('2026-02-01', 25), entry('2026-02-02', 0)]
    expect(Object.fromEntries(pagesPerMonth([], entries))).toEqual({ '2026-01': 100, '2026-02': 25 })
  })

  it("counts a finished book's unlogged pages in its finish month, without double counting", () => {
    const logged = book({ id: 'logged', status: 'read', pages: 300, finishedOn: '2026-02-10' })
    const straightToRead = book({ status: 'read', pages: 200, finishedOn: '2026-03-03' })
    const noPageCount = book({ status: 'read', finishedOn: '2026-03-04' })
    const entries = [entry('2026-01-20', 100, 'logged'), entry('2026-02-05', 150, 'logged')]
    expect(Object.fromEntries(pagesPerMonth([logged, straightToRead, noPageCount], entries))).toEqual({
      '2026-01': 100,
      '2026-02': 200, // 150 logged + the last 50, finished that month
      '2026-03': 200,
    })
  })

  it('never goes negative when more pages were logged than the book has (a re-read)', () => {
    const reread = book({ id: 'r', status: 'read', pages: 100, finishedOn: '2026-04-01' })
    const entries = [entry('2026-03-01', 100, 'r'), entry('2026-03-20', 100, 'r')]
    expect(Object.fromEntries(pagesPerMonth([reread], entries))).toEqual({ '2026-03': 200 })
  })
})

describe('monthsOfYear', () => {
  it('lists all 12 months with zeros filled in', () => {
    const months = monthsOfYear(2026, new Map([['2026-03', 2], ['2025-03', 9]]))
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ month: '2026-01', value: 0 })
    expect(months[2]).toEqual({ month: '2026-03', value: 2 })
    expect(months[11].month).toBe('2026-12')
  })
})

describe('topAuthors and topTags', () => {
  it('ranks authors by count, then A–Z, merging case and spacing, skipping blanks', () => {
    const books = [
      book({ author: 'Ursula K. Le Guin' }),
      book({ author: 'ursula k.  le guin' }),
      book({ author: 'Terry Pratchett' }),
      book({ author: 'Terry Pratchett' }),
      book({ author: 'Ann Leckie' }),
      book({ author: '' }),
    ]
    expect(topAuthors(books)).toEqual([
      { name: 'Terry Pratchett', count: 2 },
      { name: 'Ursula K. Le Guin', count: 2 },
      { name: 'Ann Leckie', count: 1 },
    ])
    expect(topAuthors(books, 1)).toEqual([{ name: 'Terry Pratchett', count: 2 }])
  })

  it('ranks tags across books', () => {
    const books = [book({ tags: ['sci-fi', 'classic'] }), book({ tags: ['Sci-Fi'] }), book({ tags: ['poetry'] })]
    expect(topTags(books)).toEqual([
      { name: 'sci-fi', count: 2 },
      { name: 'classic', count: 1 },
      { name: 'poetry', count: 1 },
    ])
    expect(topTags([])).toEqual([])
  })
})

describe('yearlyProgress', () => {
  const books = [
    book({ status: 'read', finishedOn: '2026-01-10' }),
    book({ status: 'read', finishedOn: '2026-06-10' }),
    book({ status: 'read', finishedOn: '2026-09-10' }),
    book({ status: 'read', finishedOn: '2025-12-31' }),
    book({ status: 'reading', startedOn: '2026-02-01' }),
  ]

  it('counts books finished in the year against the goal', () => {
    expect(finishedIn(books, 2026)).toHaveLength(3)
    expect(yearlyProgress(books, 12, 2026, '2026-10-16')).toMatchObject({ read: 3, goal: 12, percent: 25 })
    expect(yearlyProgress(books, 2, 2026, '2026-10-16').percent).toBe(150)
  })

  it('works out the even-pace target for this year, past years and future years', () => {
    expect(yearlyProgress(books, 365, 2026, '2026-01-01').expected).toBe(1)
    expect(yearlyProgress(books, 12, 2026, '2026-07-01').expected).toBe(5) // 182/365 of 12
    expect(yearlyProgress(books, 12, 2026, '2026-12-31').expected).toBe(12)
    expect(yearlyProgress(books, 12, 2025, '2026-10-16').expected).toBe(12)
    expect(yearlyProgress(books, 12, 2027, '2026-10-16').expected).toBe(0)
  })

  it('has no percent without a goal', () => {
    expect(yearlyProgress(books, undefined, 2026, '2026-10-16')).toEqual({ read: 3, goal: 0, percent: 0, expected: 0 })
  })
})

describe('bookPercent', () => {
  it('uses the page when there is a page count, else the stored percent', () => {
    expect(bookPercent(book({ pages: 200, currentPage: 50 }))).toBe(25)
    expect(bookPercent(book({ pages: 200, currentPage: 500 }))).toBe(100)
    expect(bookPercent(book({ percent: 42 }))).toBe(42)
    expect(bookPercent(book({}))).toBeUndefined()
  })
})
