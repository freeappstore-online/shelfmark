import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LibraryStore, ValidationError, createLibraryStore, normalizeTags } from './store'

let n = 0
const open: LibraryStore[] = []

/** A store on a fresh database, with a clock that ticks 1ms per call. */
function makeStore(dbName = `test-${++n}`, start = 1_000) {
  let t = start
  const store = createLibraryStore({ dbName, now: () => t++, requestPersist: () => Promise.resolve(true) })
  open.push(store)
  return store
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

describe('books', () => {
  it('adds a book with defaults and reads it back', async () => {
    const store = makeStore()
    const book = await store.addBook({ title: '  Middlemarch ', author: 'George Eliot' })
    expect(book).toMatchObject({
      title: 'Middlemarch',
      author: 'George Eliot',
      status: 'want',
      shelves: [],
      notes: '',
      tags: [],
    })
    expect(book.id).toBeTruthy()
    expect(await store.getBook(book.id)).toEqual(book)
  })

  it('stores status, dates, rating, notes and tags', async () => {
    const store = makeStore()
    const book = await store.addBook({
      title: 'Piranesi',
      status: 'read',
      startedOn: '2026-01-02',
      finishedOn: '2026-01-20',
      rating: 4.5,
      notes: 'The house is beautiful.',
      tags: ['fantasy', ' Fantasy ', '', 'short'],
      isbn: '978-1-63557-563-7',
      pages: 272,
    })
    expect(await store.getBook(book.id)).toMatchObject({
      status: 'read',
      startedOn: '2026-01-02',
      finishedOn: '2026-01-20',
      rating: 4.5,
      notes: 'The house is beautiful.',
      tags: ['fantasy', 'short'],
      isbn: '9781635575637',
      pages: 272,
    })
  })

  it('updates fields, clears optional ones with null and bumps updatedAt', async () => {
    const store = makeStore()
    const book = await store.addBook({ title: 'Dune', rating: 3, startedOn: '2026-02-01' })
    const updated = await store.updateBook(book.id, { status: 'reading', rating: null, notes: 'Spice.' })
    expect(updated.status).toBe('reading')
    expect(updated.rating).toBeUndefined()
    expect('rating' in updated).toBe(false)
    expect(updated.notes).toBe('Spice.')
    expect(updated.startedOn).toBe('2026-02-01')
    expect(updated.createdAt).toBe(book.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(book.updatedAt)
    expect(await store.getBook(book.id)).toEqual(updated)
  })

  it('keeps the Open Library cover id and work key, and rejects bad ones', async () => {
    const store = makeStore()
    const book = await store.addBook({ title: 'Dune', coverId: 11481354, olKey: '/works/OL893415W' })
    expect(await store.getBook(book.id)).toMatchObject({ coverId: 11481354, olKey: '/works/OL893415W' })
    await expect(store.addBook({ title: 'x', coverId: -1 })).rejects.toBeInstanceOf(ValidationError)
    await expect(store.addBook({ title: 'x', olKey: 'https://evil.example' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('deletes a book', async () => {
    const store = makeStore()
    const book = await store.addBook({ title: 'Gone' })
    await store.deleteBook(book.id)
    expect(await store.getBook(book.id)).toBeUndefined()
    expect(await store.listBooks()).toEqual([])
  })

  it('rejects invalid books', async () => {
    const store = makeStore()
    const bad = [
      { title: '   ' },
      { title: 'x', rating: 0 },
      { title: 'x', rating: 5.5 },
      { title: 'x', rating: 3.3 },
      { title: 'x', startedOn: '2026-02-30' },
      { title: 'x', startedOn: '2026-03-02', finishedOn: '2026-03-01' },
      { title: 'x', isbn: '12345' },
      { title: 'x', isbn: '9780441013594' },
      { title: 'x', pages: 0 },
      { title: 'x', status: 'lost' as never },
    ]
    for (const input of bad) await expect(store.addBook(input)).rejects.toBeInstanceOf(ValidationError)
    expect(await store.listBooks()).toEqual([])
  })

  it('rejects an update to a missing book or one that makes it invalid, leaving it unchanged', async () => {
    const store = makeStore()
    await expect(store.updateBook('nope', { title: 'x' })).rejects.toBeInstanceOf(ValidationError)
    const book = await store.addBook({ title: 'Kept', finishedOn: '2026-05-01' })
    await expect(store.updateBook(book.id, { startedOn: '2026-06-01' })).rejects.toThrow(/finish date/)
    expect(await store.getBook(book.id)).toEqual(book)
  })
})

describe('shelves and filtering', () => {
  it('lists books by built-in shelf, most recently updated first', async () => {
    const store = makeStore()
    const a = await store.addBook({ title: 'A', status: 'want' })
    const b = await store.addBook({ title: 'B', status: 'reading' })
    const c = await store.addBook({ title: 'C', status: 'want' })
    await store.updateBook(a.id, { notes: 'touched' })

    expect((await store.listBooks()).map((x) => x.title)).toEqual(['A', 'C', 'B'])
    expect((await store.listBooks('want')).map((x) => x.id)).toEqual([a.id, c.id])
    expect((await store.listBooks('reading')).map((x) => x.id)).toEqual([b.id])
    expect(await store.listBooks('read')).toEqual([])
  })

  it('creates, renames and deletes custom shelves', async () => {
    const store = makeStore()
    const favourites = await store.addShelf('  Favourites ')
    const book = await store.addBook({ title: 'Emma', shelves: [favourites.id, favourites.id, 'unknown'] })
    expect(book.shelves).toEqual([favourites.id])
    expect((await store.listBooks(favourites.id)).map((x) => x.id)).toEqual([book.id])

    const renamed = await store.renameShelf(favourites.id, 'All-time favourites')
    expect(renamed.name).toBe('All-time favourites')
    expect(await store.listShelves()).toEqual([renamed])

    await store.deleteShelf(favourites.id)
    expect(await store.listShelves()).toEqual([])
    expect((await store.getBook(book.id))?.shelves).toEqual([])
  })

  it('rejects empty and duplicate shelf names, including the built-in ones', async () => {
    const store = makeStore()
    await store.addShelf('Book club')
    await expect(store.addShelf(' ')).rejects.toBeInstanceOf(ValidationError)
    await expect(store.addShelf('book CLUB')).rejects.toThrow(/already/)
    await expect(store.addShelf('Reading')).rejects.toThrow(/already/)
    const other = await store.addShelf('Other')
    await expect(store.renameShelf(other.id, 'Book club')).rejects.toThrow(/already/)
    // Renaming a shelf to its own name (in another case) is fine.
    expect((await store.renameShelf(other.id, 'OTHER')).name).toBe('OTHER')
  })
})

describe('persistence and change events', () => {
  it('keeps books and shelves across reopening the database (a reload)', async () => {
    const dbName = 'reload'
    const first = makeStore(dbName)
    const shelf = await first.addShelf('Holiday')
    const book = await first.addBook({ title: 'Persuasion', shelves: [shelf.id], tags: ['austen'] })
    await first.close()

    const second = makeStore(dbName, 5_000)
    expect(await second.getBook(book.id)).toEqual(book)
    expect(await second.listShelves()).toEqual([shelf])
  })

  it('notifies subscribers after each write and asks for persistent storage once', async () => {
    const requestPersist = vi.fn(() => Promise.resolve(true))
    const store = createLibraryStore({ dbName: 'events', requestPersist })
    open.push(store)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const book = await store.addBook({ title: 'One' })
    await store.updateBook(book.id, { rating: 5 })
    await store.deleteBook(book.id)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(requestPersist).toHaveBeenCalledTimes(1)
    unsubscribe()
    await store.addShelf('Quiet')
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('normalizeTags', () => {
  it('trims, collapses spaces and drops case-insensitive duplicates', () => {
    expect(normalizeTags(['  sci  fi ', 'Sci Fi', 'classic', ''])).toEqual(['sci fi', 'classic'])
  })
})

describe('progress and goals (schema 2)', () => {
  it('logs pages read per day, moving a Want-to-read book to Reading', async () => {
    const store = makeStore()
    const book = await store.addBook({ title: 'Long', pages: 400 })
    let updated = await store.logProgress(book.id, { page: 50 }, '2026-10-15')
    expect(updated).toMatchObject({ currentPage: 50, status: 'reading', startedOn: '2026-10-15' })
    await store.logProgress(book.id, { page: 80 }, '2026-10-16')
    updated = await store.logProgress(book.id, { page: 120 }, '2026-10-16')
    // Going back a few pages logs nothing negative.
    await store.logProgress(book.id, { page: 110 }, '2026-10-17')
    expect((await store.getBook(book.id))?.currentPage).toBe(110)
    expect((await store.listProgress()).map((e) => [e.date, e.pagesRead])).toEqual([
      ['2026-10-15', 50],
      ['2026-10-16', 70],
      ['2026-10-17', 0],
    ])
  })

  it('stores a percent for a book without a page count, and a page for one with', async () => {
    const store = makeStore()
    const noPages = await store.addBook({ title: 'Ebook', status: 'reading' })
    expect((await store.logProgress(noPages.id, { percent: 33.33 }, '2026-10-16')).percent).toBe(33.3)
    const withPages = await store.addBook({ title: 'Paper', pages: 200 })
    const b = await store.logProgress(withPages.id, { percent: 25 }, '2026-10-16')
    expect(b.currentPage).toBe(50)
    expect(b.percent).toBeUndefined()
    // Pages past the end are capped.
    expect((await store.logProgress(withPages.id, { page: 999 }, '2026-10-16')).currentPage).toBe(200)
  })

  it('rejects bad progress', async () => {
    const store = makeStore()
    const noPages = await store.addBook({ title: 'x' })
    await expect(store.logProgress(noPages.id, { page: 10 })).rejects.toThrow(/page count/)
    await expect(store.logProgress(noPages.id, { percent: 101 })).rejects.toBeInstanceOf(ValidationError)
    await expect(store.logProgress(noPages.id, { percent: 5 }, '2026-13-01')).rejects.toBeInstanceOf(ValidationError)
    await expect(store.logProgress('missing', { percent: 5 })).rejects.toBeInstanceOf(ValidationError)
    expect(await store.listProgress()).toEqual([])
  })

  it("deleting a book deletes its progress, and only its", async () => {
    const store = makeStore()
    const a = await store.addBook({ title: 'A', pages: 100 })
    const b = await store.addBook({ title: 'B', pages: 100 })
    await store.logProgress(a.id, { page: 10 }, '2026-10-16')
    await store.logProgress(b.id, { page: 20 }, '2026-10-16')
    await store.deleteBook(a.id)
    expect((await store.listProgress()).map((e) => e.bookId)).toEqual([b.id])
  })

  it('keeps a goal per year, and removes it with null', async () => {
    const store = makeStore()
    expect(await store.getGoal(2026)).toBeUndefined()
    await store.setGoal(2026, 24)
    await store.setGoal(2027, 30)
    expect(await store.getGoal(2026)).toBe(24)
    await store.setGoal(2026, null)
    expect(await store.getGoal(2026)).toBeUndefined()
    expect(await store.getGoal(2027)).toBe(30)
    await expect(store.setGoal(2026, 0)).rejects.toBeInstanceOf(ValidationError)
    await expect(store.setGoal(2026, 2.5)).rejects.toBeInstanceOf(ValidationError)
  })

  it('upgrades a version-1 database, keeping its books', async () => {
    const dbName = 'upgrade-v1'
    const v1 = await openDB(dbName, 1, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('status', 'status')
        books.createIndex('updatedAt', 'updatedAt')
        db.createObjectStore('shelves', { keyPath: 'id' })
      },
    })
    const old = { id: 'old', title: 'Old', author: '', status: 'reading', shelves: [], notes: '', tags: [], createdAt: 1, updatedAt: 1 }
    await v1.put('books', old)
    v1.close()

    const store = makeStore(dbName)
    expect(await store.getBook('old')).toEqual(old)
    expect(await store.listProgress()).toEqual([])
    await store.setGoal(2026, 12)
    expect(await store.getGoal(2026)).toBe(12)
  })
})

describe('issue 2 regressions', () => {
  it('converts progress in both directions and preserves the page delta baseline', async () => {
    const s = makeStore()
    const b = await s.addBook({ title: 'Conversion' })
    await s.logProgress(b.id, { percent: 50 })
    expect(await s.updateBook(b.id, { pages: 200 })).toMatchObject({ currentPage: 100 })
    expect((await s.getBook(b.id))?.percent).toBeUndefined()
    await s.logProgress(b.id, { page: 120 })
    expect((await s.listProgress())[0].pagesRead).toBe(20)
    const converted = await s.updateBook(b.id, { pages: null })
    expect(converted.percent).toBe(60)
    expect(converted.currentPage).toBeUndefined()
  })
  it('rejects a stale progress revision inside the write transaction', async () => {
    const s = makeStore()
    const b = await s.addBook({ title: 'Conflict', pages: 200 })
    await s.logProgress(b.id, { page: 80 })
    await expect(s.logProgress(b.id, { page: 20 }, undefined, b.updatedAt)).rejects.toThrow('Progress changed')
    expect((await s.getBook(b.id))?.currentPage).toBe(80)
  })
  it('serializes concurrent creation and rename name checks across connections', async () => {
    const s = makeStore('concurrent-regression')
    const other = makeStore('concurrent-regression')
    const created = await Promise.allSettled([s.addShelf('Concurrent'), other.addShelf(' concurrent ')])
    expect(created.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const a = await s.addShelf('A'), b = await s.addShelf('B')
    const renamed = await Promise.allSettled([s.renameShelf(a.id, 'Same'), other.renameShelf(b.id, 'same')])
    expect(renamed.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  })
})
