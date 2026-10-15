// The library's CRUD API. Local-only: books and shelves live in IndexedDB on
// this device and nothing here makes a network request. The database opens
// lazily on first use, so importing this module doesn't touch IndexedDB.

import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import { parseIsbn } from './isbn'
import { type Book, type BookStatus, type ISODate, type Shelf, type ShelfFilter, STATUSES } from './types'

export const DB_NAME = 'shelfmark'
const DB_VERSION = 1

interface LibraryDB extends DBSchema {
  books: { key: string; value: Book; indexes: { status: BookStatus; updatedAt: number } }
  shelves: { key: string; value: Shelf }
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
  updateBook(id: string, patch: BookPatch): Promise<Book>
  deleteBook(id: string): Promise<void>
  /** Custom shelves, oldest first. */
  listShelves(): Promise<Shelf[]>
  addShelf(name: string): Promise<Shelf>
  renameShelf(id: string, name: string): Promise<Shelf>
  /** Deletes the shelf and takes every book off it (the books stay). */
  deleteShelf(id: string): Promise<void>
  /** Called after any write, from this tab or another. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  close(): Promise<void>
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
      await (await db()).delete('books', id)
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

function isValidDate(value: string): boolean {
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
