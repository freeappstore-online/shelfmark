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
  /** 0.5 to 5 in half-star steps; absent means unrated. */
  rating?: number
  notes: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** What the library list shows: everything, a built-in shelf, or a custom shelf's id. */
export type ShelfFilter = 'all' | BookStatus | (string & {})
