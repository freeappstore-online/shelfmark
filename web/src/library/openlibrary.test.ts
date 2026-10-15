import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OfflineError,
  SearchError,
  coverUrl,
  createSearchClient,
  debounce,
  parseResults,
  searchUrl,
  toBookInput,
} from './openlibrary'

type Fetch = typeof globalThis.fetch

const DUNE_DOC = {
  key: '/works/OL893415W',
  title: 'Dune',
  author_name: ['Frank Herbert'],
  first_publish_year: 1965,
  isbn: ['0441013597', '9780441013593', '9780340960196'],
  cover_i: 11481354,
  number_of_pages_median: 604,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch mock that answers every request with `body`. */
function mockFetch(body: unknown = { docs: [DUNE_DOC] }, status = 200) {
  return vi.fn<Fetch>(async () => json(body, status))
}

const params = (url: string) => Object.fromEntries(new URL(url).searchParams)

describe('searchUrl', () => {
  it('searches text by q, with a fields filter and a limit', () => {
    const url = searchUrl('  the   left hand ')!
    expect(url.startsWith('https://openlibrary.org/search.json?')).toBe(true)
    expect(params(url)).toEqual({
      q: 'the left hand',
      fields: 'key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median',
      limit: '20',
    })
  })

  it('searches by title, author or ISBN when asked', () => {
    expect(params(searchUrl('Dune', 'title')!).title).toBe('Dune')
    expect(params(searchUrl('Le Guin', 'author')!).author).toBe('Le Guin')
    expect(params(searchUrl('978-0-441-01359-3', 'isbn')!).isbn).toBe('9780441013593')
  })

  it('treats an ISBN-shaped query as an ISBN', () => {
    const p = params(searchUrl('0-441-01359-7')!)
    expect(p.isbn).toBe('0441013597')
    expect(p.q).toBeUndefined()
    expect(params(searchUrl('123456789x')!).isbn).toBe('123456789X')
  })

  it('returns undefined for a blank query', () => {
    expect(searchUrl('   ')).toBeUndefined()
  })
})

describe('parseResults and toBookInput', () => {
  it('maps a doc to a result and a new book', () => {
    const [result] = parseResults({ docs: [DUNE_DOC] })
    expect(result).toEqual({
      key: '/works/OL893415W',
      title: 'Dune',
      authors: ['Frank Herbert'],
      firstPublishYear: 1965,
      isbn: '9780441013593',
      coverId: 11481354,
      pages: 604,
    })
    expect(toBookInput(result)).toEqual({
      title: 'Dune',
      author: 'Frank Herbert',
      olKey: '/works/OL893415W',
      isbn: '9780441013593',
      pages: 604,
      coverId: 11481354,
    })
  })

  it('prefers the ISBN that was searched for', () => {
    expect(parseResults({ docs: [DUNE_DOC] }, '9780340960196')[0].isbn).toBe('9780340960196')
  })

  it('skips docs without a key or title and tolerates missing fields', () => {
    const results = parseResults({ docs: [{ title: 'No key' }, { key: '/works/OL1W' }, { key: '/works/OL2W', title: 'Bare' }] })
    expect(results).toEqual([{ key: '/works/OL2W', title: 'Bare', authors: [] }])
    expect(toBookInput(results[0])).toEqual({ title: 'Bare', author: '', olKey: '/works/OL2W' })
  })

  it('rejects a body without docs', () => {
    expect(() => parseResults({ error: 'nope' })).toThrow(SearchError)
  })
})

describe('createSearchClient', () => {
  afterEach(() => vi.useRealTimers())

  it('fetches only the search URL, politely, and parses the results', async () => {
    const fetch = mockFetch()
    const client = createSearchClient({ fetch, isOnline: () => true })
    const results = await client.search('dune')
    expect(results.map((r) => r.title)).toEqual(['Dune'])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toBe(searchUrl('dune'))
    expect(init).toMatchObject({ headers: { Accept: 'application/json' }, credentials: 'omit' })
  })

  it('serves a repeated query from the cache until it expires', async () => {
    let t = 0
    const fetch = mockFetch()
    const client = createSearchClient({ fetch, now: () => t, ttlMs: 1000, isOnline: () => true })
    await client.search('dune')
    t = 999
    await client.search('  Dune '.toLowerCase())
    expect(fetch).toHaveBeenCalledTimes(1)
    t = 2000
    await client.search('dune')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('drops the least recently used query when the cache is full', async () => {
    const fetch = mockFetch()
    const client = createSearchClient({ fetch, maxEntries: 2, isOnline: () => true })
    await client.search('a')
    await client.search('b')
    await client.search('a') // a is now the most recent
    await client.search('c') // evicts b
    expect(fetch).toHaveBeenCalledTimes(3)
    await client.search('a')
    expect(fetch).toHaveBeenCalledTimes(3)
    await client.search('b')
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('makes no request for a blank query', async () => {
    const fetch = mockFetch()
    expect(await createSearchClient({ fetch }).search('  ')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports offline without a request, and when the network is unreachable', async () => {
    const fetch = mockFetch()
    await expect(createSearchClient({ fetch, isOnline: () => false }).search('dune')).rejects.toBeInstanceOf(OfflineError)
    expect(fetch).not.toHaveBeenCalled()

    const failing = vi.fn<Fetch>(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(createSearchClient({ fetch: failing, isOnline: () => true }).search('dune')).rejects.toBeInstanceOf(
      OfflineError,
    )
  })

  it('still answers from the cache while offline', async () => {
    let online = true
    const fetch = mockFetch()
    const client = createSearchClient({ fetch, isOnline: () => online })
    await client.search('dune')
    online = false
    expect((await client.search('dune')).map((r) => r.title)).toEqual(['Dune'])
  })

  it('reports error statuses and bad bodies as SearchError, and does not cache them', async () => {
    const fetch = mockFetch({ error: 'busy' }, 503)
    const client = createSearchClient({ fetch, isOnline: () => true })
    await expect(client.search('dune')).rejects.toThrow(/503/)
    await expect(client.search('dune')).rejects.toBeInstanceOf(SearchError)
    expect(fetch).toHaveBeenCalledTimes(2)

    const notJson = vi.fn<Fetch>(async () => new Response('<html>', { status: 200 }))
    await expect(createSearchClient({ fetch: notJson, isOnline: () => true }).search('dune')).rejects.toBeInstanceOf(
      SearchError,
    )
  })

  it('passes the abort signal through and rethrows the abort', async () => {
    const controller = new AbortController()
    const fetch = vi.fn<Fetch>(async (_url, init) => {
      controller.abort()
      init?.signal?.throwIfAborted()
      return json({ docs: [] })
    })
    const client = createSearchClient({ fetch, isOnline: () => true })
    await expect(client.search('dune', 'any', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal)
  })
})

describe('coverUrl', () => {
  it('points at the covers host and asks for a 404 when there is no cover', () => {
    expect(coverUrl(11481354)).toBe('https://covers.openlibrary.org/b/id/11481354-M.jpg?default=false')
    expect(coverUrl(1, 'S')).toBe('https://covers.openlibrary.org/b/id/1-S.jpg?default=false')
  })
})

describe('debounce', () => {
  afterEach(() => vi.useRealTimers())

  it('calls once with the last arguments after a quiet period, and can be cancelled', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 300)
    d('d')
    d('du')
    vi.advanceTimersByTime(299)
    d('dune')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('dune')

    d('again')
    d.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
