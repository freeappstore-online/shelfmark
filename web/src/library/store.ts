// The library's CRUD API. Local-only: books and shelves live in IndexedDB on
// this device and nothing here makes a network request. The database opens
// lazily on first use, so importing this module doesn't touch IndexedDB.

import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { localDate } from './dates'
import { parseIsbn } from './isbn'
import {
  type Book,
  type BookStatus,
  type ISODate,
  type ImportMode,
  type LibraryExport,
  type ProgressEntry,
  type Shelf,
  type ShelfFilter,
  SCHEMA_VERSION,
  STATUSES,
} from './types'

export const DB_NAME = 'shelfmark'
// 1: books, shelves. 2: progress, settings (#234).
const DB_VERSION = SCHEMA_VERSION
const GOALS_KEY = 'goals'

interface LibraryDB extends DBSchema {
  books: { key: string; value: Book; indexes: { status: BookStatus; updatedAt: number } }
  shelves: { key: string; value: Shelf }
  progress: { key: string; value: ProgressEntry; indexes: { bookId: string; date: ISODate } }
  /** GOALS_KEY → yearly book goals by year. */
  settings: { key: string; value: Record<string, number> }
}

/** What a caller supplies to add a book. Everything but the title has a default. */
export type BookInput = Partial<Omit<Book, 'id' | 'createdAt' | 'updatedAt'>> & { title: string }
/** A partial update. `null` clears an optional field (dates, rating, isbn, pages). */
export type BookPatch = {
  [K in keyof Omit<Book, 'id' | 'createdAt' | 'updatedAt'>]?: undefined extends Book[K] ? Book[K] | null : Book[K]
}

export interface LibraryStore {
  /** Books on a shelf (default all), most recently updated first. */
  listBooks(filter?: ShelfFilter): Promise<Book[]>
  getBook(id: string): Promise<Book | undefined>
  addBook(input: BookInput): Promise<Book>
  /** Adds many books in one transaction (all or none), with one change event. */
  addBooks(inputs: BookInput[]): Promise<Book[]>
  updateBook(id: string, patch: BookPatch): Promise<Book>
  deleteBook(id: string): Promise<void>
  /** Custom shelves, oldest first. */
  listShelves(): Promise<Shelf[]>
  addShelf(name: string): Promise<Shelf>
  renameShelf(id: string, name: string): Promise<Shelf>
  /** Deletes the shelf and takes every book off it (the books stay). */
  deleteShelf(id: string): Promise<void>
  /**
   * Records how far into a book the reader is (a page, or a percent for a book
   * without a page count) on a date (default today). Logs the pages read for
   * the streak and stats, and moves a Want-to-read book to Reading.
   */
  logProgress(bookId: string, at: { page: number } | { percent: number }, date?: ISODate): Promise<Book>
  /** Every progress entry, oldest first. */
  listProgress(): Promise<ProgressEntry[]>
  getGoal(year: number): Promise<number | undefined>
  /** Sets the number of books to read in a year; null removes the goal. */
  setGoal(year: number, goal: number | null): Promise<void>
  /** The whole library, for a JSON backup. */
  exportAll(): Promise<LibraryExport>
  /**
   * Imports a backup already checked by parseLibraryJSON (backup.ts).
   * replace: the backup becomes the whole library. merge: books and progress
   * entries are matched by id and the newer updatedAt wins; shelves are matched
   * by id, then by name; goals in the backup win.
   */
  importAll(data: LibraryExport, mode: ImportMode): Promise<ImportSummary>
  /** Called after any write, from this tab or another. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  close(): Promise<void>
}

export interface ImportSummary {
  /** Books added or updated. */
  books: number
  shelves: number
  progress: number
}

export interface StoreOptions {
  dbName?: string
  now?: () => number
  /** Asked once, after the first write, so the browser doesn't evict the library. */
  requestPersist?: () => Promise<boolean>
}

export class ValidationError extends Error {
  name = 'ValidationError'
}

const STATUS_KEYS = new Set<string>(STATUSES.map((s) => s.key))
const MAX_TITLE = 500
const MAX_NOTES = 10_000
const MAX_TAG = 50

function defaultRequestPersist(): Promise<boolean> {
  return typeof navigator !== 'undefined' && navigator.storage?.persist
    ? navigator.storage.persist()
    : Promise.resolve(false)
}

export function openLibraryDB(name = DB_NAME): Promise<IDBPDatabase<LibraryDB>> {
  return openDB<LibraryDB>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('status', 'status')
        books.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains('shelves')) db.createObjectStore('shelves', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('progress')) {
        const progress = db.createObjectStore('progress', { keyPath: 'id' })
        progress.createIndex('bookId', 'bookId')
        progress.createIndex('date', 'date')
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
    },
  })
}

export function createLibraryStore({
  dbName = DB_NAME,
  now = Date.now,
  requestPersist = defaultRequestPersist,
}: StoreOptions = {}): LibraryStore {
  let dbPromise: Promise<IDBPDatabase<LibraryDB>> | undefined
  const db = () => (dbPromise ??= openLibraryDB(dbName))

  const listeners = new Set<() => void>()
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${dbName}-changes`) : undefined
  const notifyLocal = () => listeners.forEach((l) => l())
  if (channel) channel.onmessage = notifyLocal

  let persistAsked = false
  const changed = () => {
    notifyLocal()
    channel?.postMessage('changed')
    if (!persistAsked) {
      persistAsked = true
      requestPersist().catch(() => {})
    }
  }

  const shelfIds = async () => new Set((await (await db()).getAllKeys('shelves')) as string[])

  return {
    async listBooks(filter = 'all') {
      const d = await db()
      let books: Book[]
      if (filter === 'all') books = await d.getAll('books')
      else if (STATUS_KEYS.has(filter)) books = await d.getAllFromIndex('books', 'status', filter as BookStatus)
      else books = (await d.getAll('books')).filter((b) => b.shelves.includes(filter))
      return books.sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async getBook(id) {
      return (await db()).get('books', id)
    },

    async addBook(input) {
      const t = now()
      const book = normalizeBook(
        {
          author: '',
          status: 'want',
          shelves: [],
          notes: '',
          tags: [],
          ...input,
          id: crypto.randomUUID(),
          createdAt: t,
          updatedAt: t,
        },
        await shelfIds(),
      )
      await (await db()).add('books', book)
      changed()
      return book
    },

    async addBooks(inputs) {
      const known = await shelfIds()
      const t = now()
      const books = inputs.map((input) =>
        normalizeBook(
          { author: '', status: 'want', shelves: [], notes: '', tags: [], ...input, id: crypto.randomUUID(), createdAt: t, updatedAt: t },
          known,
        ),
      )
      const tx = (await db()).transaction('books', 'readwrite')
      for (const book of books) await tx.store.add(book)
      await tx.done
      if (books.length) changed()
      return books
    },

    async exportAll() {
      const d = await db()
      const [books, shelves, progress, goals] = await Promise.all([
        d.getAll('books'),
        d.getAll('shelves'),
        d.getAll('progress'),
        d.get('settings', GOALS_KEY),
      ])
      return {
        app: 'shelfmark',
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date(now()).toISOString(),
        books: books.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        shelves: shelves.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
        progress: progress.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
        goals: { ...goals },
      }
    },

    async importAll(data, mode) {
      const tx = (await db()).transaction(['books', 'shelves', 'progress', 'settings'], 'readwrite')
      const books = tx.objectStore('books')
      const shelves = tx.objectStore('shelves')
      const progress = tx.objectStore('progress')
      const settings = tx.objectStore('settings')
      const summary: ImportSummary = { books: 0, shelves: 0, progress: 0 }

      if (mode === 'replace') {
        await Promise.all([books.clear(), shelves.clear(), progress.clear(), settings.clear()])
        for (const s of data.shelves) await shelves.put(s)
        for (const b of data.books) await books.put(b)
        for (const p of data.progress) await progress.put(p)
        await settings.put({ ...data.goals }, GOALS_KEY)
        Object.assign(summary, { books: data.books.length, shelves: data.shelves.length, progress: data.progress.length })
      } else {
        // Shelves: same id, or else same name, is the same shelf.
        const existing = await shelves.getAll()
        const byName = new Map(existing.map((s) => [s.name.toLocaleLowerCase(), s.id]))
        const ids = new Set(existing.map((s) => s.id))
        const remap = new Map<string, string>()
        for (const s of data.shelves) {
          if (ids.has(s.id)) continue
          const sameName = byName.get(s.name.toLocaleLowerCase())
          if (sameName) remap.set(s.id, sameName)
          else {
            await shelves.put(s)
            ids.add(s.id)
            summary.shelves++
          }
        }
        for (const b of data.books) {
          const current = await books.get(b.id)
          if (current && current.updatedAt >= b.updatedAt) continue
          const shelvesOn = [...new Set(b.shelves.map((id) => remap.get(id) ?? id))].filter((id) => ids.has(id))
          await books.put({ ...b, shelves: shelvesOn })
          summary.books++
        }
        for (const p of data.progress) {
          const current = await progress.get(p.id)
          if ((current && current.updatedAt >= p.updatedAt) || !(await books.getKey(p.bookId))) continue
          await progress.put(p)
          summary.progress++
        }
        await settings.put({ ...(await settings.get(GOALS_KEY)), ...data.goals }, GOALS_KEY)
      }
      await tx.done
      changed()
      return summary
    },

    async updateBook(id, patch) {
      const d = await db()
      const known = await shelfIds()
      const tx = d.transaction('books', 'readwrite')
      const existing = await tx.store.get(id)
      if (!existing) throw new ValidationError('That book is no longer in your library.')
      const merged: Record<string, unknown> = { ...existing }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete merged[key]
        else if (value !== undefined) merged[key] = value
      }
      const book = normalizeBook(
        { ...(merged as unknown as Book), id, createdAt: existing.createdAt, updatedAt: Math.max(now(), existing.updatedAt + 1) },
        known,
      )
      await tx.store.put(book)
      await tx.done
      changed()
      return book
    },

    async deleteBook(id) {
      const tx = (await db()).transaction(['books', 'progress'], 'readwrite')
      const progress = tx.objectStore('progress')
      await tx.objectStore('books').delete(id)
      for (const key of await progress.index('bookId').getAllKeys(id)) await progress.delete(key)
      await tx.done
      changed()
    },

    async logProgress(bookId, at, date = localDate(now())) {
      if (!isValidDate(date)) throw new ValidationError('Dates should be real dates (YYYY-MM-DD).')
      const tx = (await db()).transaction(['books', 'progress'], 'readwrite')
      const books = tx.objectStore('books')
      const existing = await books.get(bookId)
      if (!existing) throw new ValidationError('That book is no longer in your library.')
      const t = Math.max(now(), existing.updatedAt + 1)
      const book: Book = { ...existing, updatedAt: t }
      let pagesRead = 0

      if ('page' in at) {
        if (!Number.isInteger(at.page) || at.page < 0) throw new ValidationError('The page should be a whole number.')
        if (!existing.pages) throw new ValidationError('Add the page count first, or record a percent.')
        const page = Math.min(at.page, existing.pages)
        pagesRead = Math.max(0, page - (existing.currentPage ?? 0))
        book.currentPage = page
      } else {
        if (!(at.percent >= 0 && at.percent <= 100)) throw new ValidationError('The percent should be 0 to 100.')
        if (existing.pages) {
          // With a page count, progress is always kept as a page.
          const page = Math.round((at.percent / 100) * existing.pages)
          pagesRead = Math.max(0, page - (existing.currentPage ?? 0))
          book.currentPage = page
        } else {
          book.percent = Math.round(at.percent * 10) / 10
        }
      }
      if (book.status === 'want') book.status = 'reading'
      if (book.status === 'reading' && !book.startedOn) book.startedOn = date
      if (book.finishedOn && book.startedOn && book.finishedOn < book.startedOn) delete book.startedOn

      const progress = tx.objectStore('progress')
      const id = `${bookId}:${date}`
      const entry = await progress.get(id)
      await progress.put({ id, bookId, date, pagesRead: (entry?.pagesRead ?? 0) + pagesRead, updatedAt: t })
      await books.put(book)
      await tx.done
      changed()
      return book
    },

    async listProgress() {
      return (await (await db()).getAllFromIndex('progress', 'date')).sort((a, b) => a.date.localeCompare(b.date))
    },

    async getGoal(year) {
      return (await (await db()).get('settings', GOALS_KEY))?.[String(year)]
    },

    async setGoal(year, goal) {
      if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new ValidationError('That year is not valid.')
      if (goal !== null && (!Number.isInteger(goal) || goal < 1 || goal > 10_000)) {
        throw new ValidationError('A goal should be a whole number of books, 1 or more.')
      }
      const tx = (await db()).transaction('settings', 'readwrite')
      const goals = { ...(await tx.store.get(GOALS_KEY)) }
      if (goal === null) delete goals[String(year)]
      else goals[String(year)] = goal
      await tx.store.put(goals, GOALS_KEY)
      await tx.done
      changed()
    },

    async listShelves() {
      return (await (await db()).getAll('shelves')).sort((a, b) => a.createdAt - b.createdAt)
    },

    async addShelf(name) {
      const shelf: Shelf = { id: crypto.randomUUID(), name: await uniqueShelfName(await db(), name), createdAt: now() }
      await (await db()).add('shelves', shelf)
      changed()
      return shelf
    },

    async renameShelf(id, name) {
      const d = await db()
      const existing = await d.get('shelves', id)
      if (!existing) throw new ValidationError('That shelf no longer exists.')
      const shelf = { ...existing, name: await uniqueShelfName(d, name, id) }
      await d.put('shelves', shelf)
      changed()
      return shelf
    },

    async deleteShelf(id) {
      const d = await db()
      const tx = d.transaction(['shelves', 'books'], 'readwrite')
      const books = tx.objectStore('books')
      const t = now()
      await tx.objectStore('shelves').delete(id)
      for (const book of await books.getAll()) {
        if (book.shelves.includes(id)) {
          await books.put({ ...book, shelves: book.shelves.filter((s) => s !== id), updatedAt: Math.max(t, book.updatedAt + 1) })
        }
      }
      await tx.done
      changed()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async close() {
      channel?.close()
      listeners.clear()
      if (dbPromise) (await dbPromise).close()
      dbPromise = undefined
    },
  }
}

async function uniqueShelfName(d: IDBPDatabase<LibraryDB>, raw: string, selfId?: string): Promise<string> {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) throw new ValidationError('Give the shelf a name.')
  if (name.length > 60) throw new ValidationError('Shelf names can be up to 60 characters.')
  const lower = name.toLocaleLowerCase()
  const taken = [...STATUSES.map((s) => ({ id: s.key, name: s.label })), ...(await d.getAll('shelves'))].some(
    (s) => s.id !== selfId && s.name.toLocaleLowerCase() === lower,
  )
  if (taken) throw new ValidationError(`There's already a shelf called "${name}".`)
  return name
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Trims, de-duplicates (ignoring case) and drops empty tags, keeping the first spelling. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG)
    const key = tag.toLocaleLowerCase()
    if (tag && !seen.has(key)) {
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}

/** Validates a complete book record and returns a cleaned copy. Throws ValidationError. */
export function normalizeBook(book: Book, knownShelves: ReadonlySet<string>): Book {
  const title = book.title?.trim() ?? ''
  if (!title) throw new ValidationError('A book needs a title.')
  if (title.length > MAX_TITLE) throw new ValidationError(`Titles can be up to ${MAX_TITLE} characters.`)
  if (!STATUS_KEYS.has(book.status)) throw new ValidationError('Pick a shelf: Want to read, Reading or Read.')
  if ((book.notes ?? '').length > MAX_NOTES) throw new ValidationError(`Notes can be up to ${MAX_NOTES} characters.`)

  const out: Book = {
    id: book.id,
    title,
    author: (book.author ?? '').trim(),
    status: book.status,
    shelves: [...new Set(book.shelves ?? [])].filter((id) => knownShelves.has(id)),
    notes: book.notes ?? '',
    tags: normalizeTags(book.tags ?? []),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  }

  if (book.isbn !== undefined && book.isbn !== '') {
    const isbn = parseIsbn(book.isbn)
    if (!isbn) throw new ValidationError("That ISBN doesn't look right. Check the 10 or 13 digits.")
    out.isbn = isbn
  }
  if (book.pages !== undefined) {
    if (!Number.isInteger(book.pages) || book.pages < 1 || book.pages > 100_000) {
      throw new ValidationError('Pages should be a whole number above 0.')
    }
    out.pages = book.pages
  }
  if (book.currentPage !== undefined) {
    if (!Number.isInteger(book.currentPage) || book.currentPage < 0) {
      throw new ValidationError('The current page should be a whole number.')
    }
    // Lowering the page count shouldn't make an otherwise good edit fail.
    out.currentPage = out.pages ? Math.min(book.currentPage, out.pages) : book.currentPage
  }
  if (book.percent !== undefined) {
    if (!(book.percent >= 0 && book.percent <= 100)) throw new ValidationError('The percent should be 0 to 100.')
    out.percent = book.percent
  }
  if (book.coverId !== undefined) {
    if (!Number.isInteger(book.coverId) || book.coverId < 1) throw new ValidationError('That cover id is not valid.')
    out.coverId = book.coverId
  }
  if (book.olKey !== undefined && book.olKey !== '') {
    if (!/^\/works\/OL\d+W$/.test(book.olKey)) throw new ValidationError('That Open Library key is not valid.')
    out.olKey = book.olKey
  }
  if (book.rating !== undefined) {
    if (!(book.rating >= 0.5 && book.rating <= 5) || book.rating * 2 !== Math.round(book.rating * 2)) {
      throw new ValidationError('Ratings go from ½ to 5 stars, in half stars.')
    }
    out.rating = book.rating
  }
  for (const key of ['startedOn', 'finishedOn'] as const) {
    const value: ISODate | undefined = book[key]
    if (value === undefined || value === '') continue
    if (!isValidDate(value)) throw new ValidationError('Dates should be real dates (YYYY-MM-DD).')
    out[key] = value
  }
  if (out.startedOn && out.finishedOn && out.finishedOn < out.startedOn) {
    throw new ValidationError("The finish date can't be before the start date.")
  }
  return out
}
