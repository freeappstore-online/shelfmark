// Goodreads import: reads the CSV from Goodreads' "Export Library"
// (goodreads.com/review/import) and adds the books that aren't already in the
// library. The file is read on the device; nothing is uploaded.

import { parseIsbn, toIsbn13 } from './isbn'
import { type BookInput, type LibraryStore, ValidationError, isValidDate } from './store'
import type { Book, BookStatus, ISODate } from './types'

/** One row of a Goodreads export. */
export interface GoodreadsBook {
  title: string
  author: string
  /** ISBN-10, when Goodreads has a valid one. */
  isbn?: string
  /** ISBN-13, when Goodreads has a valid one. */
  isbn13?: string
  /** The Goodreads exclusive shelf, as a Shelfmark status. */
  status: BookStatus
  /** Other Goodreads shelves (custom ones, plus a custom exclusive shelf like "did-not-finish"). */
  shelves: string[]
  /** 1–5 stars; 0 means unrated. */
  rating: number
  dateRead: ISODate | null
  dateAdded: ISODate | null
  pages?: number
  /** "My Review" and "Private Notes", as plain text. */
  notes: string
}

export interface GoodreadsParse {
  books: GoodreadsBook[]
  /** Rows without a title. */
  skipped: number
}

/** RFC 4180 CSV: quoted fields with "" escapes, commas and line breaks inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // Drop blank lines.
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

/** Goodreads writes ISBNs as ="0385737951" (so spreadsheets keep the leading zero); ="" when there's none. */
export function unquoteGoodreads(value: string): string {
  const m = /^="(.*)"$/.exec(value.trim())
  return (m ? m[1] : value).trim()
}

/** "2023/05/14" (Goodreads) or "2023-05-14" → "2023-05-14"; anything else → null. */
export function parseGoodreadsDate(value: string): ISODate | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim())
  if (!m) return null
  const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return isValidDate(date) ? date : null
}

const EXCLUSIVE: Record<string, BookStatus> = { 'to-read': 'want', 'currently-reading': 'reading', read: 'read' }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** Goodreads reviews are HTML-ish: <br/> for line breaks, a few tags, entities. */
function reviewText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .trim()
}

export function parseGoodreadsCSV(text: string): GoodreadsParse {
  const [header, ...rows] = parseCsv(text)
  const col = new Map((header ?? []).map((name, i) => [name.trim(), i]))
  if (!col.has('Title') || !col.has('Exclusive Shelf')) {
    throw new ValidationError("That file doesn't look like a Goodreads export. In Goodreads, use My Books → Import and export → Export Library.")
  }
  const get = (row: string[], name: string) => {
    const i = col.get(name)
    return i === undefined ? '' : (row[i] ?? '').trim()
  }

  const books: GoodreadsBook[] = []
  let skipped = 0
  for (const row of rows) {
    const title = get(row, 'Title').replace(/\s+/g, ' ')
    if (!title) {
      skipped++
      continue
    }
    const exclusive = get(row, 'Exclusive Shelf').toLowerCase()
    const dateRead = parseGoodreadsDate(get(row, 'Date Read'))
    const custom = new Set(
      get(row, 'Bookshelves')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !(s.toLowerCase() in EXCLUSIVE)),
    )
    // A custom exclusive shelf ("did-not-finish") isn't one of ours; keep it as a shelf.
    if (exclusive && !(exclusive in EXCLUSIVE)) custom.add(get(row, 'Exclusive Shelf'))
    const rating = Number(get(row, 'My Rating'))
    const pages = Number(get(row, 'Number of Pages'))
    const isbn = parseIsbn(unquoteGoodreads(get(row, 'ISBN')))
    const isbn13 = parseIsbn(unquoteGoodreads(get(row, 'ISBN13')))
    const notes = [reviewText(get(row, 'My Review')), reviewText(get(row, 'Private Notes'))].filter(Boolean).join('\n\n')

    const book: GoodreadsBook = {
      title,
      author: get(row, 'Author').replace(/\s+/g, ' '),
      status: EXCLUSIVE[exclusive] ?? (dateRead ? 'read' : 'want'),
      shelves: [...custom],
      rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
      dateRead,
      dateAdded: parseGoodreadsDate(get(row, 'Date Added')),
      notes,
    }
    if (isbn?.length === 10) book.isbn = isbn
    if (isbn13?.length === 13) book.isbn13 = isbn13
    if (Number.isInteger(pages) && pages > 0 && pages <= 100_000) book.pages = pages
    books.push(book)
  }
  return { books, skipped }
}

/** A Goodreads row as a new Shelfmark book. `shelfIds` maps Goodreads shelf names to custom shelf ids. */
export function goodreadsToBookInput(gb: GoodreadsBook, shelfIds: ReadonlyMap<string, string>): BookInput {
  const input: BookInput = {
    title: gb.title.slice(0, 500),
    author: gb.author,
    status: gb.status,
    notes: gb.notes.slice(0, 10_000),
    shelves: gb.shelves.map((s) => shelfIds.get(s.toLowerCase())).filter((id): id is string => !!id),
  }
  const isbn = gb.isbn13 ?? gb.isbn
  if (isbn) input.isbn = isbn
  if (gb.pages) input.pages = gb.pages
  if (gb.rating) input.rating = gb.rating
  if (gb.status === 'read' && gb.dateRead) input.finishedOn = gb.dateRead
  return input
}

/** Lower-case, no punctuation, no Goodreads series suffix: "Dune (Dune, #1)" → "dune". */
function titleKey(title: string, author: string): string {
  const clean = (s: string) =>
    s
      .toLocaleLowerCase()
      .replace(/\s*\([^)]*#\d[^)]*\)\s*$/, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  return `${clean(title)}|${clean(author)}`
}

/** Matches a book already in the library by ISBN (either form) or by title and author. */
export function createDuplicateFinder(existing: readonly Pick<Book, 'title' | 'author' | 'isbn'>[]) {
  const isbns = new Set<string>()
  const titles = new Set<string>()
  const add = (b: { title: string; author: string; isbn?: string }) => {
    const isbn = b.isbn && toIsbn13(b.isbn)
    if (isbn) isbns.add(isbn)
    titles.add(titleKey(b.title, b.author))
  }
  existing.forEach(add)
  return {
    /** Whether the book is already known; if not, remembers it, so a file's own repeats are caught too. */
    seen(b: { title: string; author: string; isbn?: string }): boolean {
      const isbn = b.isbn && toIsbn13(b.isbn)
      if ((isbn && isbns.has(isbn)) || titles.has(titleKey(b.title, b.author))) return true
      add(b)
      return false
    },
  }
}

export interface GoodreadsImportResult {
  added: number
  /** Already in the library (or repeated in the file). */
  duplicates: number
  /** Rows without a title. */
  skipped: number
  shelvesCreated: number
}

/** Adds a Goodreads export's books to the library, skipping ones already there. Never removes anything. */
export async function importGoodreads(store: LibraryStore, csv: string): Promise<GoodreadsImportResult> {
  const { books, skipped } = parseGoodreadsCSV(csv)
  const finder = createDuplicateFinder(await store.listBooks())
  const fresh = books.filter((b) => !finder.seen({ title: b.title, author: b.author, isbn: b.isbn13 ?? b.isbn }))

  // Custom shelves: reuse one with the same name, or create it.
  const shelfIds = new Map((await store.listShelves()).map((s) => [s.name.toLowerCase(), s.id]))
  let shelvesCreated = 0
  for (const name of new Set(fresh.flatMap((b) => b.shelves))) {
    const key = name.toLowerCase()
    if (shelfIds.has(key)) continue
    try {
      shelfIds.set(key, (await store.addShelf(name.slice(0, 60))).id)
      shelvesCreated++
    } catch (err) {
      // A name that clashes with a built-in shelf ("Reading"); the book still has its status.
      if (!(err instanceof ValidationError)) throw err
    }
  }

  const added = await store.addBooks(fresh.map((b) => goodreadsToBookInput(b, shelfIds)))
  return { added: added.length, duplicates: books.length - fresh.length, skipped, shelvesCreated }
}
