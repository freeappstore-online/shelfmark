import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Spinner } from '@freeappstore/sdk/ui'
import { Cover } from './Cover'
import { IsbnScanner } from './IsbnScanner'
import {
  OfflineError,
  type SearchMode,
  type SearchResult,
  createSearchClient,
  debounce,
  toBookInput,
} from './library/openlibrary'
import type { BookInput } from './library/store'

/** One client for the app, so the result cache outlives the dialog. */
const client = createSearchClient()
const DEBOUNCE_MS = 350

const MODES: { key: SearchMode; label: string }[] = [
  { key: 'any', label: 'Title or author' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'isbn', label: 'ISBN' },
]

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: SearchResult[] }
  | { kind: 'offline' }
  | { kind: 'error' }

const field =
  'w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)]'
const button =
  'rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--panel-strong)]'

/**
 * Finds a book on Open Library. Picking a result hands its details to the
 * add-book form; "Add by hand" opens the form empty. Only the query is sent.
 */
export function BookSearch({ onPick, onClose }: { onPick: (draft?: BookInput) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('any')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [scanning, setScanning] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      inFlight.current?.abort()
    }
  }, [])

  const run = useMemo(
    () =>
      debounce((q: string, m: SearchMode) => {
        inFlight.current?.abort()
        const controller = new AbortController()
        inFlight.current = controller
        client.search(q, m, controller.signal).then(
          (results) => !controller.signal.aborted && setState({ kind: 'done', results }),
          (err: unknown) => {
            if (controller.signal.aborted) return
            if (err instanceof OfflineError) setState({ kind: 'offline' })
            else {
              console.error('Shelfmark: search failed', err)
              setState({ kind: 'error' })
            }
          },
        )
      }, DEBOUNCE_MS),
    [],
  )
  useEffect(() => run.cancel, [run])

  // Re-run the search on every change of text, mode or connection.
  useEffect(() => {
    if (!query.trim()) {
      run.cancel()
      inFlight.current?.abort()
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'loading' })
    run(query, mode)
  }, [query, mode, online, run])

  return (
    <>
      <Modal open onClose={onClose} title="Add a book" maxWidth={560}>
        <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto]" role="search" onSubmit={(e) => e.preventDefault()}>
          <input
            type="search"
            className={field}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Open Library"
            aria-label="Search Open Library"
            inputMode={mode === 'isbn' ? 'numeric' : undefined}
            data-autofocus
          />
          <select
            className={field}
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
            aria-label="Search by"
          >
            {MODES.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="button" className={button} onClick={() => setScanning(true)}>
            Scan ISBN
          </button>
        </form>

        <div className="mt-3 min-h-24" aria-live="polite">
          {state.kind === 'idle' && (
            <p className="text-sm text-[var(--muted)]">
              {online
                ? 'Search by title, author or ISBN. Only your search is sent to Open Library.'
                : "You're offline, so search isn't available. You can still add a book by hand."}
            </p>
          )}
          {state.kind === 'loading' && (
            <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <Spinner size={16} /> Searching…
            </p>
          )}
          {state.kind === 'offline' && (
            <p className="text-sm text-[var(--muted)]">
              Can't reach Open Library — you may be offline. Add the book by hand instead, or try again when you're
              connected.
            </p>
          )}
          {state.kind === 'error' && (
            <p className="text-sm text-[var(--danger)]">
              Open Library didn't answer just now. Try again in a moment, or add the book by hand.
            </p>
          )}
          {state.kind === 'done' && state.results.length === 0 && (
            <p className="text-sm text-[var(--muted)]">No books found. Check the spelling, or add the book by hand.</p>
          )}
          {state.kind === 'done' && state.results.length > 0 && (
            <ul className="grid max-h-[50dvh] gap-1 overflow-y-auto">
              {state.results.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => onPick(toBookInput(r))}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] p-2 text-left hover:bg-[var(--panel-strong)]"
                  >
                    <Cover coverId={r.coverId} title={r.title} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[var(--ink)]">{r.title}</span>
                      <span className="block text-sm text-[var(--muted)]">
                        {[r.authors.join(', '), r.firstPublishYear].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-between gap-2">
          <button type="button" className={button} onClick={() => onPick()}>
            Add by hand
          </button>
          <button type="button" className={button} onClick={onClose}>
            Cancel
          </button>
        </div>
      </Modal>
      {scanning && (
        <IsbnScanner
          onClose={() => setScanning(false)}
          onIsbn={(isbn) => {
            // The scanned or typed ISBN becomes an ISBN search on Open Library.
            setScanning(false)
            setMode('isbn')
            setQuery(isbn)
          }}
        />
      )}
    </>
  )
}
