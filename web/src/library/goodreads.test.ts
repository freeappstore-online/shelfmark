import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDuplicateFinder,
  goodreadsToBookInput,
  importGoodreads,
  parseCsv,
  parseGoodreadsCSV,
  parseGoodreadsDate,
  unquoteGoodreads,
} from './goodreads'
import { type LibraryStore, ValidationError, createLibraryStore } from './store'

// The header of a real Goodreads "Export Library" file.
const HEADER =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies'

/** A row in Goodreads' format: ISBNs as ="…" inside a quoted field, so the raw CSV has "=""…""". */
function row(f: {
  title: string
  author?: string
  isbn?: string
  isbn13?: string
  rating?: number
  pages?: string
  dateRead?: string
  dateAdded?: string
  shelves?: string
  exclusive: string
  review?: string
  privateNotes?: string
}) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  return [
    '1',
    q(f.title),
    q(f.author ?? ''),
    q(''),
    q(''),
    q(`="${f.isbn ?? ''}"`),
    q(`="${f.isbn13 ?? ''}"`),
    String(f.rating ?? 0),
    '4.10',
    q('Publisher'),
    'Paperback',
    f.pages ?? '',
    '2010',
    '2008',
    f.dateRead ?? '',
    f.dateAdded ?? '2024/01/02',
    q(f.shelves ?? ''),
    q(''),
    f.exclusive,
    q(f.review ?? ''),
    '',
    q(f.privateNotes ?? ''),
    '1',
    '0',
  ].join(',')
}

const CSV = [
  HEADER,
  row({
    title: 'The Hunger Games (The Hunger Games, #1)',
    author: 'Suzanne Collins',
    isbn: '0439023483',
    isbn13: '9780439023481',
    rating: 4,
    pages: '374',
    dateRead: '2023/05/14',
    dateAdded: '2023/04/01',
    shelves: 'favorites, ya',
    exclusive: 'read',
    review: 'Gripping.<br/><br/>Would &amp; will reread, "truly".',
  }),
  row({ title: 'The Maze Runner', author: 'James Dashner', isbn: '0385737955', exclusive: 'to-read', shelves: 'to-read' }),
  row({ title: 'Dune', author: 'Frank Herbert', exclusive: 'currently-reading', shelves: 'currently-reading, sci-fi', rating: 0 }),
  row({ title: 'Ulysses', author: 'James Joyce', exclusive: 'did-not-finish', shelves: 'did-not-finish', privateNotes: 'Maybe later.' }),
].join('\r\n')

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and line breaks in fields, CRLF, a BOM and blank lines', () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\n\n1,,3'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'two\nlines'],
      ['1', '', '3'],
    ])
  })
})

describe('Goodreads fields', () => {
  it('unquotes ="…" ISBNs, including empty ones', () => {
    expect(unquoteGoodreads('="0385737955"')).toBe('0385737955')
    expect(unquoteGoodreads('=""')).toBe('')
    expect(unquoteGoodreads('9780439023481')).toBe('9780439023481')
  })

  it('parses Goodreads dates and rejects impossible ones', () => {
    expect(parseGoodreadsDate('2023/05/14')).toBe('2023-05-14')
    expect(parseGoodreadsDate('2023/5/4')).toBe('2023-05-04')
    expect(parseGoodreadsDate('2023-05-14')).toBe('2023-05-14')
    expect(parseGoodreadsDate('2023/02/30')).toBeNull()
    expect(parseGoodreadsDate('')).toBeNull()
    expect(parseGoodreadsDate('May 14, 2023')).toBeNull()
  })
})

describe('parseGoodreadsCSV', () => {
  const { books, skipped } = parseGoodreadsCSV(CSV)

  it('reads every row', () => {
    expect(books.map((b) => b.title)).toEqual([
      'The Hunger Games (The Hunger Games, #1)',
      'The Maze Runner',
      'Dune',
      'Ulysses',
    ])
    expect(skipped).toBe(0)
  })

  it('reads a full row: ISBNs, rating, pages, dates, shelves and review', () => {
    expect(books[0]).toEqual({
      title: 'The Hunger Games (The Hunger Games, #1)',
      author: 'Suzanne Collins',
      isbn: '0439023483',
      isbn13: '9780439023481',
      status: 'read',
      shelves: ['favorites', 'ya'],
      rating: 4,
      dateRead: '2023-05-14',
      dateAdded: '2023-04-01',
      pages: 374,
      notes: 'Gripping.\n\nWould & will reread, "truly".',
    })
  })

  it('maps the exclusive shelves to Want to read, Reading and Read', () => {
    expect(books.map((b) => b.status)).toEqual(['read', 'want', 'reading', 'want'])
  })

  it('keeps other shelves, not the exclusive ones, and keeps a custom exclusive shelf as a shelf', () => {
    expect(books[1].shelves).toEqual([])
    expect(books[2].shelves).toEqual(['sci-fi'])
    expect(books[3].shelves).toEqual(['did-not-finish'])
    expect(books[3].notes).toBe('Maybe later.')
  })

  it('treats a 0 rating as unrated and empty fields as missing', () => {
    expect(books[2].rating).toBe(0)
    expect(books[2].dateRead).toBeNull()
    expect(books[2].isbn).toBeUndefined()
    expect(books[2].isbn13).toBeUndefined()
    expect(books[2].pages).toBeUndefined()
    expect(books[1].isbn).toBe('0385737955')
  })

  it('drops invalid ISBNs and counts rows without a title', () => {
    const csv = [HEADER, row({ title: 'Bad ISBN', isbn: '0385737952', exclusive: 'read' }), row({ title: '', exclusive: 'read' })].join('\n')
    const parsed = parseGoodreadsCSV(csv)
    expect(parsed.books).toHaveLength(1)
    expect(parsed.books[0].isbn).toBeUndefined()
    expect(parsed.skipped).toBe(1)
  })

  it('rejects a file that is not a Goodreads export', () => {
    expect(() => parseGoodreadsCSV('name,age\nAda,36')).toThrow(ValidationError)
    expect(() => parseGoodreadsCSV('')).toThrow(/Goodreads export/)
  })
})

describe('goodreadsToBookInput', () => {
  it('prefers the ISBN-13 and only gives Read books a finish date', () => {
    const [hungerGames, , dune] = parseGoodreadsCSV(CSV).books
    expect(goodreadsToBookInput(hungerGames, new Map([['favorites', 's1']]))).toEqual({
      title: 'The Hunger Games (The Hunger Games, #1)',
      author: 'Suzanne Collins',
      status: 'read',
      notes: 'Gripping.\n\nWould & will reread, "truly".',
      shelves: ['s1'],
      isbn: '9780439023481',
      pages: 374,
      rating: 4,
      finishedOn: '2023-05-14',
    })
    expect(goodreadsToBookInput(dune, new Map())).toEqual({
      title: 'Dune',
      author: 'Frank Herbert',
      status: 'reading',
      notes: '',
      shelves: [],
    })
  })
})

describe('createDuplicateFinder', () => {
  it('matches by ISBN in either form, or by title and author ignoring case, punctuation and series', () => {
    const finder = createDuplicateFinder([
      { title: 'The Hunger Games', author: 'Suzanne Collins' },
      { title: 'Something else', author: 'X', isbn: '0385737955' },
    ])
    expect(finder.seen({ title: 'The Hunger Games (The Hunger Games, #1)', author: 'suzanne collins' })).toBe(true)
    expect(finder.seen({ title: 'The Maze Runner', author: 'James Dashner', isbn: '9780385737951' })).toBe(true)
    expect(finder.seen({ title: 'Dune', author: 'Frank Herbert' })).toBe(false)
    // Now remembered, so a repeat in the same file is caught.
    expect(finder.seen({ title: 'DUNE', author: 'Frank Herbert.' })).toBe(true)
  })
})

describe('importGoodreads', () => {
  let store: LibraryStore
  afterEach(() => store?.close())

  it('adds new books with their shelves, skipping ones already in the library', async () => {
    let t = 1_000
    store = createLibraryStore({ dbName: 'goodreads-import', now: () => t++, requestPersist: () => Promise.resolve(true) })
    await store.addShelf('Favorites')
    await store.addBook({ title: 'Dune', author: 'Frank Herbert', status: 'read' })

    const result = await importGoodreads(store, CSV)
    expect(result).toEqual({ added: 3, duplicates: 1, skipped: 0, shelvesCreated: 2 })

    const shelves = await store.listShelves()
    expect(shelves.map((s) => s.name)).toEqual(['Favorites', 'ya', 'did-not-finish'])
    const books = await store.listBooks()
    const hg = books.find((b) => b.title.startsWith('The Hunger Games'))!
    expect(hg).toMatchObject({ status: 'read', rating: 4, finishedOn: '2023-05-14', isbn: '9780439023481', pages: 374 })
    expect(hg.shelves).toEqual([shelves[0].id, shelves[1].id])
    // The existing Dune is untouched.
    expect(books.filter((b) => b.title === 'Dune')).toHaveLength(1)
    expect(books.find((b) => b.title === 'Dune')?.status).toBe('read')

    // Importing the same file again adds nothing.
    expect(await importGoodreads(store, CSV)).toEqual({ added: 0, duplicates: 4, skipped: 0, shelvesCreated: 0 })
  })
})
