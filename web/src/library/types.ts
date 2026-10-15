// The library's data model. Everything here is stored on the device only.

/** The three built-in shelves. Every book is on exactly one of them. */
export type BookStatus = 'want' | 'reading' | 'read'

export const STATUSES: { key: BookStatus; label: string }[] = [
  { key: 'want', label: 'Want to read' },
  { key: 'reading', label: 'Reading' },
  { key: 'read', label: 'Read' },
]

/** YYYY-MM-DD, in the reader's own calendar (no time zone). */
export type ISODate = string

/** A shelf of the reader's own. A book can be on any number of them. */
export interface Shelf {
  id: string
  name: string
  createdAt: number
}

export interface Book {
  id: string
  title: string
  author: string
  /** ISBN-10 or ISBN-13, digits (and a final X) only. */
  isbn?: string
  pages?: number
  /** Open Library cover id (covers.openlibrary.org/b/id/<id>-M.jpg). */
  coverId?: number
  /** Open Library work key, e.g. "/works/OL45804W", for a book added from search. */
  olKey?: string
  status: BookStatus
  /** Ids of custom shelves. */
  shelves: string[]
  startedOn?: ISODate
  finishedOn?: ISODate
  /** How far into the book, for one with a page count. At most `pages`. */
  currentPage?: number
  /** How far into the book, 0–100, for one without a page count. */
  percent?: number
  /** 0.5 to 5 in half-star steps; absent means unrated. */
  rating?: number
  notes: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

/**
 * Reading done on one book on one day, for the streak and pages per month.
 * One entry per book per day; later updates that day add to it.
 */
export interface ProgressEntry {
  /** `${bookId}:${date}` */
  id: string
  bookId: string
  date: ISODate
  /** Pages read that day (0 for a book without a page count). */
  pagesRead: number
  updatedAt: number
}

/** What the library list shows: everything, a built-in shelf, or a custom shelf's id. */
export type ShelfFilter = 'all' | BookStatus | (string & {})

/** The IndexedDB version, which is also the export format's version. */
export const SCHEMA_VERSION = 2

/** The whole library, as exported to (and imported from) a JSON file. */
export interface LibraryExport {
  app: 'shelfmark'
  schemaVersion: number
  /** ISO timestamp. */
  exportedAt: string
  books: Book[]
  shelves: Shelf[]
  progress: ProgressEntry[]
  /** Yearly book goals, by year ("2026": 24). */
  goals: Record<string, number>
}

/** replace: the file becomes the whole library. merge: per record, the newer one wins. */
export type ImportMode = 'replace' | 'merge'
