import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { backupFileName, parseLibraryJSON, serializeLibrary } from './backup'
import { type LibraryStore, ValidationError, createLibraryStore } from './store'
import type { LibraryExport } from './types'

let n = 0
const open: LibraryStore[] = []
function makeStore(start = 1_000) {
  let t = start
  const store = createLibraryStore({ dbName: `backup-${++n}`, now: () => t++, requestPersist: () => Promise.resolve(true) })
  open.push(store)
  return store
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()))
})

/** A library using every field: shelves, every book field, progress and goals. */
async function fullLibrary() {
  const store = makeStore()
  const shelf = await store.addShelf('Book club')
  await store.addShelf('Holiday')
  const read = await store.addBook({
    title: 'Piranesi',
    author: 'Susanna Clarke',
    isbn: '9781635575637',
    pages: 272,
    coverId: 10520611,
    olKey: '/works/OL20893680W',
    status: 'read',
    shelves: [shelf.id],
    startedOn: '2026-01-02',
    finishedOn: '2026-01-20',
    rating: 4.5,
    notes: 'Line one\nLine "two" — with unicode ✓',
    tags: ['fantasy', 'short'],
  })
  const reading = await store.addBook({ title: 'Middlemarch', author: 'George Eliot', pages: 880 })
  await store.logProgress(reading.id, { page: 40 }, '2026-10-15')
  await store.logProgress(reading.id, { page: 95 }, '2026-10-16')
  const ebook = await store.addBook({ title: 'An ebook', status: 'reading' })
  await store.logProgress(ebook.id, { percent: 12.5 }, '2026-10-16')
  await store.setGoal(2026, 24)
  await store.setGoal(2025, 12)
  return { store, read }
}

const withoutTime = ({ exportedAt: _t, ...rest }: LibraryExport) => rest

describe('JSON export and import', () => {
  it('round-trips the whole library losslessly', async () => {
    const { store } = await fullLibrary()
    const exported = await store.exportAll()
    expect(exported.books).toHaveLength(3)
    expect(exported.shelves).toHaveLength(2)
    expect(exported.progress).toHaveLength(3)
    expect(exported.goals).toEqual({ 2025: 12, 2026: 24 })

    const text = serializeLibrary(exported)
    const parsed = parseLibraryJSON(text)
    expect(parsed).toEqual(exported)

    const restored = makeStore(50_000)
    await restored.importAll(parsed, 'replace')
    const again = await restored.exportAll()
    expect(withoutTime(again)).toEqual(withoutTime(exported))
    // And byte for byte, apart from the export time.
    expect(serializeLibrary({ ...again, exportedAt: exported.exportedAt })).toBe(text)
  })

  it('replace makes the backup the whole library', async () => {
    const { store } = await fullLibrary()
    const backup = parseLibraryJSON(serializeLibrary(await store.exportAll()))
    const other = makeStore()
    await other.addBook({ title: 'Gone after replace' })
    await other.addShelf('Gone too')
    await other.setGoal(2030, 5)
    await other.importAll(backup, 'replace')
    expect((await other.listBooks()).map((b) => b.title).sort()).toEqual(['An ebook', 'Middlemarch', 'Piranesi'])
    expect((await other.listShelves()).map((s) => s.name)).toEqual(['Book club', 'Holiday'])
    expect(await other.getGoal(2030)).toBeUndefined()
    expect(await other.getGoal(2026)).toBe(24)
  })

  it('merge keeps both libraries, the newer copy of a book wins, and same-named shelves are one shelf', async () => {
    const { store, read } = await fullLibrary()
    const backup = parseLibraryJSON(serializeLibrary(await store.exportAll()))

    // Edit the book after the backup was taken: the newer local edit must survive a merge.
    await store.updateBook(read.id, { notes: 'Edited after the backup' })
    await store.addBook({ title: 'Only here' })
    const summary = await store.importAll(backup, 'merge')
    expect(summary).toEqual({ books: 0, shelves: 0, progress: 0 })
    expect((await store.getBook(read.id))?.notes).toBe('Edited after the backup')
    expect(await store.listBooks()).toHaveLength(4)

    // Into a different library with its own "book club" shelf.
    const other = makeStore(100_000)
    const club = await other.addShelf('book club')
    await other.addBook({ title: 'Mine' })
    await other.setGoal(2026, 10)
    expect(await other.importAll(backup, 'merge')).toEqual({ books: 3, shelves: 1, progress: 3 })
    // Shelves list oldest first; Holiday keeps its creation time from the backup.
    expect((await other.listShelves()).map((s) => s.name)).toEqual(['Holiday', 'book club'])
    expect((await other.getBook(read.id))?.shelves).toEqual([club.id])
    expect(await other.listBooks()).toHaveLength(4)
    expect(await other.getGoal(2026)).toBe(24)
    expect(await other.listProgress()).toHaveLength(3)
  })

  it('imports a schema-1 backup, which had no progress or goals', async () => {
    const v1 = {
      app: 'shelfmark',
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      books: [{ id: 'b1', title: 'Old', author: '', status: 'want', shelves: [], notes: '', tags: [], createdAt: 1, updatedAt: 1 }],
      shelves: [],
    }
    const parsed = parseLibraryJSON(JSON.stringify(v1))
    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.progress).toEqual([])
    expect(parsed.goals).toEqual({})
    const store = makeStore()
    await store.importAll(parsed, 'replace')
    expect((await store.getBook('b1'))?.title).toBe('Old')
  })

  it('names the file by date', () => {
    expect(backupFileName('2026-10-16')).toBe('shelfmark-2026-10-16.json')
  })

  it('merges repeated shelf names in an older backup into one shelf without losing book memberships', async () => {
    const source = makeStore()
    const first = await source.addShelf('Club')
    const book = await source.addBook({ title: 'Shared', shelves: [first.id] })
    const backup = await source.exportAll()
    const duplicate = { ...first, id: 'legacy-duplicate', name: ' club ' }
    backup.shelves.push(duplicate)
    backup.books[0] = { ...book, shelves: [first.id, duplicate.id] }

    const target = makeStore()
    await target.importAll(parseLibraryJSON(serializeLibrary(backup)), 'merge')
    const shelves = await target.listShelves()
    expect(shelves).toHaveLength(1)
    expect(shelves[0].name).toBe('Club')
    expect((await target.getBook(book.id))?.shelves).toEqual([shelves[0].id])
  })
})

describe('parseLibraryJSON rejects bad files without writing anything', () => {
  const good = () => ({
    app: 'shelfmark',
    schemaVersion: 2,
    exportedAt: '',
    books: [{ id: 'b1', title: 'A', author: '', status: 'read', shelves: ['s1'], notes: '', tags: [], createdAt: 1, updatedAt: 1 }],
    shelves: [{ id: 's1', name: 'S', createdAt: 1 }],
    progress: [{ id: 'b1:2026-01-01', bookId: 'b1', date: '2026-01-01', pagesRead: 3, updatedAt: 1 }],
    goals: { 2026: 5 },
  })
  const bad = (mutate: (d: ReturnType<typeof good>) => void) => {
    const d = good()
    mutate(d)
    return JSON.stringify(d)
  }

  it('accepts the good fixture', () => {
    expect(parseLibraryJSON(JSON.stringify(good())).books).toHaveLength(1)
  })

  it('omits a damaged export timestamp so the restore dialog never shows Invalid Date', () => {
    const fixture = good()
    fixture.exportedAt = 'not a timestamp'
    expect(parseLibraryJSON(JSON.stringify(fixture)).exportedAt).toBe('')
  })

  it.each([
    ['not JSON', 'not json', /isn't JSON/],
    ['another app', bad((d) => (d.app = 'other')), /isn't a Shelfmark backup/],
    ['a newer schema', bad((d) => (d.schemaVersion = 3)), /newer version/],
    ['no books', bad((d) => delete (d as Partial<typeof d>).books), /missing/],
    ['a book without an id', bad((d) => (d.books[0].id = '')), /damaged/],
    ['a duplicate book', bad((d) => d.books.push({ ...d.books[0] })), /twice/],
    ['an invalid book', bad((d) => ((d.books[0] as { rating?: number }).rating = 9)), /Book "A" in that backup: Ratings/],
    ['progress for a missing book', bad((d) => (d.progress[0].bookId = 'nope')), /Progress entry 1/],
    ['negative pages read', bad((d) => (d.progress[0].pagesRead = -1)), /Progress entry 1/],
    ['a bad goal', bad((d) => ((d.goals as Record<string, number>)[2026] = 0)), /2026 goal/],
    ['a nameless shelf', bad((d) => (d.shelves[0].name = ' ')), /Shelf 1/],
  ])('%s', (_label, text, message) => {
    expect(() => parseLibraryJSON(text)).toThrow(ValidationError)
    expect(() => parseLibraryJSON(text)).toThrow(message)
  })

  it('drops shelf ids on a book that point at no shelf', () => {
    const parsed = parseLibraryJSON(bad((d) => (d.books[0].shelves = ['s1', 'ghost'])))
    expect(parsed.books[0].shelves).toEqual(['s1'])
  })
})
