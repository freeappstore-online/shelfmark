import { type ChangeEvent, useRef, useState } from 'react'
import { Modal } from '@freeappstore/sdk/ui'
import { errorMessage } from './Library'
import { backupFileName, parseLibraryJSON, serializeLibrary } from './library/backup'
import { localDate } from './library/dates'
import { importGoodreads } from './library/goodreads'
import type { ImportMode, LibraryExport } from './library/types'
import { library } from './library/useLibrary'
import { button, primaryButton, dangerButton } from './ui'


const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Reads a picked file as text and clears the input, so picking the same file again still fires. */
async function readPicked(e: ChangeEvent<HTMLInputElement>): Promise<string | undefined> {
  const file = e.target.files?.[0]
  e.target.value = ''
  return file?.text()
}

/** Privacy, JSON backup and restore, and Goodreads import. Everything here runs on the device. */
export function DataPanel() {
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pending, setPending] = useState<LibraryExport | null>(null)
  const [busy, setBusy] = useState(false)
  const backupInput = useRef<HTMLInputElement>(null)
  const goodreadsInput = useRef<HTMLInputElement>(null)

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setStatus({ kind: 'ok', text: await work() })
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const exportBackup = () =>
    run(async () => {
      const data = await library.exportAll()
      const url = URL.createObjectURL(new Blob([serializeLibrary(data)], { type: 'application/json' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(localDate()) })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return `Saved a backup of ${plural(data.books.length, 'book')}.`
    })

  const pickBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = await readPicked(e)
    if (text === undefined) return
    try {
      setPending(parseLibraryJSON(text))
      setStatus(null)
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) })
    }
  }

  const restore = (mode: ImportMode) => {
    const data = pending
    setPending(null)
    if (!data) return
    run(async () => {
      const s = await library.importAll(data, mode)
      return mode === 'replace'
        ? `Restored ${plural(s.books, 'book')} and ${plural(s.shelves, 'shelf', 'shelves')} from the backup.`
        : `Merged the backup: ${plural(s.books, 'book')} added or updated, ${plural(s.shelves, 'new shelf', 'new shelves')}.`
    })
  }

  const pickGoodreads = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = await readPicked(e)
    if (text === undefined) return
    run(async () => {
      const r = await importGoodreads(library, text)
      const parts = [`Added ${plural(r.added, 'book')} from Goodreads`]
      if (r.shelvesCreated) parts.push(`${plural(r.shelvesCreated, 'new shelf', 'new shelves')}`)
      if (r.duplicates) parts.push(`${plural(r.duplicates, 'book')} already in your library skipped`)
      if (r.skipped) parts.push(`${plural(r.skipped, 'row')} without a title skipped`)
      return `${parts.join(', ')}.`
    })
  }

  return (
    <>
      <section className="mt-6" aria-labelledby="privacy">
        <h2 id="privacy" className="display-font text-xl font-semibold text-[var(--ink)]">
          Your privacy
        </h2>
        <p className="mt-2 text-[var(--muted)]">
          Your library is stored only on this device, in your browser. There's no account, and your books, notes,
          ratings and reading progress are never sent anywhere. When you search, just the search goes to{' '}
          <a href="https://openlibrary.org" className="underline">
            Open Library
          </a>
          , and book covers are loaded from Open Library and the Internet Archive (archive.org), which stores its
          covers. Barcode scans and imported files are read on your device.
          FreeAppStore counts page visits to the app; it never sees your library.
        </p>
        <p className="mt-2 text-[var(--muted)]">
          Because nothing is kept online, clearing your browser's site data deletes your library. Save a backup now
          and then.
        </p>
      </section>

      <section className="mt-6" aria-labelledby="your-data">
        <h2 id="your-data" className="display-font text-xl font-semibold text-[var(--ink)]">
          Your data
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4">
            <h3 className="font-semibold text-[var(--ink)]">Backup</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Everything (books, shelves, progress and goals) in one JSON file. Restore it here or on another device.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={primaryButton} onClick={exportBackup} disabled={busy}>
                Export JSON
              </button>
              <button type="button" className={button} onClick={() => backupInput.current?.click()} disabled={busy}>
                Import JSON
              </button>
            </div>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4">
            <h3 className="font-semibold text-[var(--ink)]">Goodreads</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              In Goodreads, go to My Books → Import and export → Export Library, then pick the CSV file here. Books you
              already have are skipped.
            </p>
            <div className="mt-3">
              <button type="button" className={button} onClick={() => goodreadsInput.current?.click()} disabled={busy}>
                Import Goodreads CSV
              </button>
            </div>
          </div>
        </div>
        <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={pickBackup} />
        <input ref={goodreadsInput} type="file" accept=".csv,text/csv" hidden onChange={pickGoodreads} />
        <p
          className={`mt-3 text-sm ${status?.kind === 'error' ? 'text-[var(--danger)]' : 'text-[var(--ink)]'}`}
          role={status?.kind === 'error' ? 'alert' : 'status'}
        >
          {busy ? 'Working…' : status?.text}
        </p>
      </section>

      <Modal open={pending !== null} onClose={() => setPending(null)} title="Import this backup?" maxWidth={480}>
        {pending && (
          <>
            <p className="text-[var(--muted)]">
              It has {plural(pending.books.length, 'book')}, {plural(pending.shelves.length, 'shelf', 'shelves')} and{' '}
              {plural(pending.progress.length, 'day')} of reading progress
              {pending.exportedAt && `, saved ${new Date(pending.exportedAt).toLocaleDateString()}`}.
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              <strong className="text-[var(--ink)]">Merge</strong> adds it to your library; where a book is in both, the
              more recently changed copy is kept. <strong className="text-[var(--ink)]">Replace</strong> deletes your
              current library first.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={button} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className={dangerButton} onClick={() => restore('replace')}>
                Replace my library
              </button>
              <button type="button" className={primaryButton} onClick={() => restore('merge')} data-autofocus>
                Merge
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
