// Open Library search. The only network requests Shelfmark's library makes:
// search.json for results and covers.openlibrary.org for cover images. The
// query is all that's sent; nothing from the library goes with it.

import { parseIsbn } from './isbn'
import type { BookInput } from './store'

export const SEARCH_URL = 'https://openlibrary.org/search.json'
export const COVERS_URL = 'https://covers.openlibrary.org'

/** Only what we show or save, so responses stay small. */
const FIELDS = 'key,title,author_name,first_publish_year,isbn,cover_i,number_of_pages_median'
const LIMIT = 20

/** 'any' matches title and author, and looks up an ISBN-shaped query by ISBN. */
export type SearchMode = 'any' | 'title' | 'author' | 'isbn'

export interface SearchResult {
  /** Open Library work key, e.g. "/works/OL45804W". */
  key: string
  title: string
  authors: string[]
  firstPublishYear?: number
  isbn?: string
  coverId?: number
  pages?: number
}

/** No connection: search can't run, but the book can still be added by hand. */
export class OfflineError extends Error {
  name = 'OfflineError'
}

/** Open Library answered with an error or something we couldn't read. */
export class SearchError extends Error {
  name = 'SearchError'
}

export interface SearchClientOptions {
  fetch?: typeof fetch
  /** How long a result list is reused. Default 10 minutes. */
  ttlMs?: number
  /** Most queries kept; the least recently used is dropped. Default 50. */
  maxEntries?: number
  now?: () => number
  isOnline?: () => boolean
}

export interface SearchClient {
  /** Results for a query, from the cache when it's fresh. A blank query returns []. */
  search(query: string, mode?: SearchMode, signal?: AbortSignal): Promise<SearchResult[]>
}

/** The compact ISBN if the text is a valid ISBN-10 or ISBN-13 (check digit included), else undefined. */
export const asIsbn = parseIsbn

/** The search.json URL for a query. Undefined for a blank query, or an invalid ISBN in 'isbn' mode. */
export function searchUrl(query: string, mode: SearchMode = 'any'): string | undefined {
  const q = query.trim().replace(/\s+/g, ' ')
  if (!q) return undefined
  const isbn = asIsbn(q)
  if (mode === 'isbn' && !isbn) return undefined
  const param = mode === 'isbn' || (mode === 'any' && isbn) ? 'isbn' : mode === 'any' ? 'q' : mode
  const params = new URLSearchParams({ [param]: param === 'isbn' ? isbn! : q, fields: FIELDS, limit: String(LIMIT) })
  return `${SEARCH_URL}?${params}`
}

/** A cover image URL. `default=false` makes a missing cover a 404, so the img shows our placeholder. */
export function coverUrl(coverId: number, size: 'S' | 'M' | 'L' = 'M'): string {
  return `${COVERS_URL}/b/id/${coverId}-${size}.jpg?default=false`
}

interface RawDoc {
  key?: unknown
  title?: unknown
  author_name?: unknown
  first_publish_year?: unknown
  isbn?: unknown
  cover_i?: unknown
  number_of_pages_median?: unknown
}

const positiveInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined)

/** Turns search.json docs into results, skipping any without a key or title. */
export function parseResults(body: unknown, searchedIsbn?: string): SearchResult[] {
  const docs = (body as { docs?: unknown })?.docs
  if (!Array.isArray(docs)) throw new SearchError('Open Library sent an unexpected response.')
  const out: SearchResult[] = []
  for (const doc of docs as RawDoc[]) {
    if (typeof doc?.key !== 'string' || typeof doc.title !== 'string' || !doc.title.trim()) continue
    const isbns = Array.isArray(doc.isbn) ? doc.isbn.filter((i): i is string => typeof i === 'string') : []
    // The ISBN that was searched for, else the first ISBN-13, else any.
    const isbn =
      (searchedIsbn && isbns.find((i) => asIsbn(i) === searchedIsbn)) ??
      isbns.find((i) => asIsbn(i)?.length === 13) ??
      isbns.find((i) => asIsbn(i))
    const result: SearchResult = {
      key: doc.key,
      title: doc.title.trim(),
      authors: Array.isArray(doc.author_name) ? doc.author_name.filter((a): a is string => typeof a === 'string') : [],
    }
    const year = positiveInt(doc.first_publish_year)
    if (year) result.firstPublishYear = year
    if (isbn) result.isbn = asIsbn(isbn)
    const coverId = positiveInt(doc.cover_i)
    if (coverId) result.coverId = coverId
    const pages = positiveInt(doc.number_of_pages_median)
    if (pages) result.pages = pages
    out.push(result)
  }
  return out
}

/** A result as a new book's fields, ready for the add-book form. */
export function toBookInput(result: SearchResult): BookInput {
  const input: BookInput = { title: result.title, author: result.authors.join(', '), olKey: result.key }
  if (result.isbn) input.isbn = result.isbn
  if (result.pages) input.pages = result.pages
  if (result.coverId) input.coverId = result.coverId
  return input
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export function createSearchClient({
  fetch: fetchImpl = (...args) => fetch(...args),
  ttlMs = 10 * 60_000,
  maxEntries = 50,
  now = Date.now,
  isOnline = defaultIsOnline,
}: SearchClientOptions = {}): SearchClient {
  const cache = new Map<string, { at: number; results: SearchResult[] }>()

  return {
    async search(query, mode = 'any', signal) {
      const url = searchUrl(query, mode)
      if (!url) return []

      const hit = cache.get(url)
      if (hit && now() - hit.at < ttlMs) {
        // Re-insert so the Map's order stays least-recently-used first.
        cache.delete(url)
        cache.set(url, hit)
        return hit.results
      }
      if (!isOnline()) throw new OfflineError("You're offline.")

      let response: Response
      try {
        // Browsers don't let pages set User-Agent, and a custom header would
        // force a CORS preflight on every search, so politeness here is: a
        // plain GET asking for JSON, no cookies, a small `fields`/`limit`,
        // debounced input and a cache.
        response = await fetchImpl(url, { headers: { Accept: 'application/json' }, credentials: 'omit', signal })
      } catch (err) {
        if (signal?.aborted) throw err
        // fetch only rejects (rather than resolving with an error status) when the network is unreachable.
        throw new OfflineError("Couldn't reach Open Library.")
      }
      if (!response.ok) throw new SearchError(`Open Library search failed (${response.status}).`)
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new SearchError('Open Library sent an unexpected response.')
      }
      const isbnParam = new URL(url).searchParams.get('isbn') ?? undefined
      const results = parseResults(body, isbnParam)

      cache.set(url, { at: now(), results })
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!)
      return results
    },
  }
}

/** Calls `fn` once `ms` have passed without another call. `cancel` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}
