import { type FormEvent, type ReactNode, useState } from 'react'
import { ConfirmDialog, EmptyState, Modal, PageHeader } from '@freeappstore/sdk/ui'
import { type BookInput, type BookPatch, ValidationError } from './library/store'
import { type Book, type BookStatus, type Shelf, type ShelfFilter, STATUSES } from './library/types'
import { library, useLibrary } from './library/useLibrary'

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label])) as Record<BookStatus, string>

const button =
  'rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--panel-strong)]'
const primaryButton =
  'rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-deep)]'
const field =
  'w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)]'

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function errorMessage(err: unknown): string {
  if (err instanceof ValidationError) return err.message
  console.error('Shelfmark: saving failed', err)
  return "Couldn't save. Your browser may be out of storage space."
}

/** "★★★½" for 3.5. */
export function stars(rating: number): string {
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '')
}

export function Library() {
  const [filter, setFilter] = useState<ShelfFilter>('all')
  const [editing, setEditing] = useState<Book | 'new' | null>(null)
  const [managingShelves, setManagingShelves] = useState(false)
  const shelves = useLibrary((s) => s.listShelves())
  const books = useLibrary((s) => s.listBooks(filter), [filter])

  // A deleted custom shelf can't stay selected.
  const activeFilter =
    filter === 'all' || STATUSES.some((s) => s.key === filter) || shelves?.some((s) => s.id === filter) ? filter : 'all'
  const shelfName = new Map((shelves ?? []).map((s) => [s.id, s.name]))
  const filters = [
    { key: 'all', label: 'All' },
    ...STATUSES,
    ...(shelves ?? []).map((s) => ({ key: s.id, label: s.name })),
  ]

  return (
    <>
      <PageHeader
        title="Library"
        description="Your books, kept on this device."
        actions={
          <button type="button" className={primaryButton} onClick={() => setEditing('new')}>
            Add book
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Shelf">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={activeFilter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              activeFilter === f.key
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--ink)]'
                : 'border-[var(--line-strong)] text-[var(--muted)]'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button type="button" className="text-sm text-[var(--muted)] underline" onClick={() => setManagingShelves(true)}>
          Edit shelves
        </button>
      </div>

      {books === undefined ? null : books.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={activeFilter === 'all' ? 'No books yet' : 'Nothing on this shelf'}
            message={
              activeFilter === 'all'
                ? 'Add the books you want to read, are reading or have read.'
                : 'Books you put on this shelf will show up here.'
            }
            action={
              <button type="button" className={primaryButton} onClick={() => setEditing('new')}>
                Add book
              </button>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {books.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => setEditing(book)}
                className="w-full rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4 text-left hover:border-[var(--line-strong)]"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="display-font text-lg font-semibold text-[var(--ink)]">{book.title}</span>
                  {book.rating !== undefined && (
                    <span className="shrink-0 text-[var(--accent)]" aria-label={`${book.rating} out of 5 stars`}>
                      {stars(book.rating)}
                    </span>
                  )}
                </span>
                {book.author && <span className="block text-sm text-[var(--muted)]">{book.author}</span>}
                <span className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-[var(--sky-soft)] px-2 py-0.5 text-[var(--sky-deep)]">
                    {STATUS_LABEL[book.status]}
                  </span>
                  {book.shelves.map((id) => (
                    <span key={id} className="rounded-full bg-[var(--mint-soft)] px-2 py-0.5 text-[var(--mint-deep)]">
                      {shelfName.get(id)}
                    </span>
                  ))}
                  {book.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--line-strong)] px-2 py-0.5 text-[var(--muted)]">
                      #{tag}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <BookForm
          book={editing === 'new' ? undefined : editing}
          defaultStatus={STATUSES.some((s) => s.key === activeFilter) ? (activeFilter as BookStatus) : 'want'}
          defaultShelves={shelves?.some((s) => s.id === activeFilter) ? [activeFilter] : []}
          shelves={shelves ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ShelvesDialog open={managingShelves} shelves={shelves ?? []} onClose={() => setManagingShelves(false)} />
    </>
  )
}

const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

function BookForm({
  book,
  defaultStatus,
  defaultShelves,
  shelves,
  onClose,
}: {
  book?: Book
  defaultStatus: BookStatus
  defaultShelves: string[]
  shelves: Shelf[]
  onClose: () => void
}) {
  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [status, setStatus] = useState<BookStatus>(book?.status ?? defaultStatus)
  const [startedOn, setStartedOn] = useState(book?.startedOn ?? '')
  const [finishedOn, setFinishedOn] = useState(book?.finishedOn ?? '')
  const [rating, setRating] = useState(book?.rating?.toString() ?? '')
  const [notes, setNotes] = useState(book?.notes ?? '')
  const [tags, setTags] = useState(book?.tags.join(', ') ?? '')
  const [onShelves, setOnShelves] = useState<string[]>(book?.shelves ?? defaultShelves)
  const [isbn, setIsbn] = useState(book?.isbn ?? '')
  const [pages, setPages] = useState(book?.pages?.toString() ?? '')
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Moving a book to Reading or Read fills in today's date if there isn't one yet.
  const changeStatus = (next: BookStatus) => {
    setStatus(next)
    if (next === 'reading' && !startedOn) setStartedOn(today())
    if (next === 'read' && !finishedOn) setFinishedOn(today())
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const patch: BookPatch = {
      title,
      author,
      status,
      startedOn: startedOn || null,
      finishedOn: finishedOn || null,
      rating: rating ? Number(rating) : null,
      notes,
      tags: tags.split(','),
      shelves: onShelves,
      isbn: isbn.trim() || null,
      pages: pages ? Number(pages) : null,
    }
    try {
      if (book) await library.updateBook(book.id, patch)
      else await library.addBook(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? undefined])) as BookInput)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const remove = async () => {
    if (book) await library.deleteBook(book.id)
    onClose()
  }

  return (
    <>
      <Modal open onClose={onClose} title={book ? 'Edit book' : 'Add book'} maxWidth={560}>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <Field label="Title">
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required data-autofocus />
          </Field>
          <Field label="Author">
            <input className={field} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          <Field label="Shelf">
            <select className={field} value={status} onChange={(e) => changeStatus(e.target.value as BookStatus)}>
              {STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Started">
              <input type="date" className={field} value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
            </Field>
            <Field label="Finished">
              <input type="date" className={field} value={finishedOn} onChange={(e) => setFinishedOn(e.target.value)} />
            </Field>
          </div>
          <Field label="Rating">
            <select className={field} value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="">No rating</option>
              {RATINGS.map((r) => (
                <option key={r} value={r}>
                  {stars(r)} ({r})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea className={field} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Tags (separated by commas)">
            <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="classic, book club" />
          </Field>
          {shelves.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-[var(--ink)]">Your shelves</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {shelves.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={onShelves.includes(s.id)}
                      onChange={(e) =>
                        setOnShelves((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="ISBN">
              <input className={field} inputMode="numeric" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
            </Field>
            <Field label="Pages">
              <input
                type="number"
                min={1}
                className={field}
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            {book ? (
              <button type="button" className="text-sm text-[var(--danger)] underline" onClick={() => setConfirmingDelete(true)}>
                Delete book
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" className={button} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                Save
              </button>
            </div>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this book?"
        message={`"${book?.title ?? ''}" and its dates, rating, notes and tags will be removed from this device.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
      {label}
      <span className="font-normal">{children}</span>
    </label>
  )
}

function ShelvesDialog({ open, shelves, onClose }: { open: boolean; shelves: Shelf[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<Shelf | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await library.addShelf(name)
      setName('')
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Your shelves" maxWidth={480}>
        <p className="text-sm text-[var(--muted)]">
          Want to read, Reading and Read are always there. Add shelves of your own; a book can be on several.
        </p>
        <ul className="mt-3 grid gap-2">
          {shelves.map((s) => (
            <ShelfRow key={s.id} shelf={s} onDelete={() => setDeleting(s)} onError={setError} />
          ))}
        </ul>
        <form onSubmit={add} className="mt-3 flex gap-2">
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New shelf"
            aria-label="New shelf name"
          />
          <button type="submit" className={primaryButton}>
            Add
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className={button} onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this shelf?"
        message={`The books on "${deleting?.name ?? ''}" stay in your library; they're just taken off this shelf.`}
        confirmLabel="Delete shelf"
        variant="danger"
        onConfirm={async () => {
          if (deleting) await library.deleteShelf(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function ShelfRow({ shelf, onDelete, onError }: { shelf: Shelf; onDelete: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(shelf.name)
  const save = async () => {
    if (name === shelf.name) return
    try {
      await library.renameShelf(shelf.id, name)
      onError('')
    } catch (err) {
      onError(errorMessage(err))
      setName(shelf.name)
    }
  }
  return (
    <li className="flex gap-2">
      <input
        className={field}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        aria-label={`Rename ${shelf.name}`}
      />
      <button type="button" className={button} onClick={onDelete} aria-label={`Delete ${shelf.name}`}>
        Delete
      </button>
    </li>
  )
}
