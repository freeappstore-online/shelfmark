import { type FormEvent, useId, useState } from 'react'
import { EmptyState, PageHeader, ProgressBar } from '@freeappstore/sdk/ui'
import { Cover } from './Cover'
import { errorMessage } from './Library'
import { localDate } from './library/dates'
import {
  type Ranked,
  bookPercent,
  booksPerMonth,
  finishedIn,
  longestStreak,
  monthsOfYear,
  pagesPerMonth,
  readingStreak,
  topAuthors,
  topTags,
  yearlyProgress,
} from './library/stats'
import type { Book } from './library/types'
import { library, useLibrary } from './library/useLibrary'
import { button, field } from './ui'

const panel = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function Progress() {
  const today = localDate()
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const data = useLibrary(
    async (s) => {
      const [books, progress, goal] = await Promise.all([s.listBooks(), s.listProgress(), s.getGoal(year)])
      return { books, progress, goal }
    },
    [year],
  )
  if (!data) return <PageHeader title="Progress" />

  const { books, progress, goal } = data
  const reading = books.filter((b) => b.status === 'reading')
  const yearly = yearlyProgress(books, goal, year, today)
  const finished = finishedIn(books, year)
  const streak = readingStreak(progress, today)
  const longest = longestStreak(progress)

  return (
    <>
      <PageHeader title="Progress" description="Your reading, worked out on this device." />

      <section className="mt-6" aria-labelledby="reading-now">
        <h2 id="reading-now" className="display-font text-xl font-semibold text-[var(--ink)]">
          Reading now
        </h2>
        {reading.length === 0 ? (
          <div className="mt-3">
            <EmptyState message="Books on your Reading shelf show up here, so you can note how far you've got." />
          </div>
        ) : (
          <ul className="mt-3 grid gap-2">
            {reading.map((b) => (
              <ReadingRow key={b.id} book={b} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <section className={panel} aria-labelledby="streak">
          <h2 id="streak" className="text-sm font-semibold text-[var(--muted)]">
            Reading streak
          </h2>
          <p className="display-font mt-1 text-4xl font-semibold text-[var(--ink)]">{plural(streak, 'day')}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {streak === 0
              ? 'Note your page on a book you’re reading to start one.'
              : progress.some((e) => e.date === today)
                ? 'You’ve read today.'
                : 'Read today to keep it going.'}{' '}
            {longest > streak && `Longest: ${plural(longest, 'day')}.`}
          </p>
        </section>
        <GoalPanel key={year} year={year} goal={goal} progress={yearly} isThisYear={year === thisYear} />
      </div>

      <div className="mt-8 flex items-center justify-between gap-2">
        <h2 className="display-font text-xl font-semibold text-[var(--ink)]">{year} in books</h2>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => setYear(year - 1)} aria-label={`Show ${year - 1}`}>
            ← {year - 1}
          </button>
          {year < thisYear && (
            <button type="button" className={button} onClick={() => setYear(year + 1)} aria-label={`Show ${year + 1}`}>
              {year + 1} →
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MonthBars title="Books finished" unit="book" year={year} values={monthsOfYear(year, booksPerMonth(books))} />
        <MonthBars
          title="Pages read"
          unit="page"
          year={year}
          values={monthsOfYear(year, pagesPerMonth(books, progress))}
        />
        <TopList
          title="Top authors"
          items={topAuthors(finished)}
          empty={`Authors of books you finish in ${year} show up here.`}
        />
        <TopList
          title="Top tags"
          items={topTags(finished)}
          empty={`Tags on books you finish in ${year} show up here.`}
        />
      </div>
    </>
  )
}

function ReadingRow({ book }: { book: Book }) {
  const byPage = !!book.pages
  const persisted = String((byPage ? book.currentPage : book.percent) ?? '')
  const [draft, setDraft] = useState<{ value: string; revision: number } | null>(null)
  const value = draft?.value ?? persisted
  const conflict = draft !== null && draft.revision !== book.updatedAt
  const [error, setError] = useState('')
  const percent = bookPercent(book) ?? 0

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (conflict) {
      setDraft(null)
      return setError('Progress changed. Review the latest value before saving.')
    }
    const n = Number(value)
    if (value.trim() === '' || !Number.isFinite(n))
      return setError(byPage ? 'Enter a page number.' : 'Enter a percent.')
    try {
      await library.logProgress(book.id, byPage ? { page: Math.round(n) } : { percent: n }, undefined, draft?.revision ?? book.updatedAt)
      setDraft(null)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <li className={`${panel} flex gap-3`}>
      <Cover coverId={book.coverId} title={book.title} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[var(--ink)]">{book.title}</p>
        {book.author && <p className="text-sm text-[var(--muted)]">{book.author}</p>}
        <div className="mt-2">
          <ProgressBar value={percent} max={100} label={`${book.title}: ${percent}%`} />
        </div>
        <form onSubmit={save} className="mt-2 flex items-center gap-2" noValidate>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            {byPage ? 'Page' : 'Percent'}
            <input
              className={`${field} w-24`}
              type="number"
              inputMode="numeric"
              min={0}
              max={byPage ? book.pages : 100}
              value={value}
              onChange={(e) => setDraft({ value: e.target.value, revision: draft?.revision ?? book.updatedAt })}
            />
            <span>{byPage ? `of ${book.pages}` : '%'}</span>
          </label>
          <button type="submit" className={button}>
            Save
          </button>
          <span className="text-sm text-[var(--muted)]">{percent}%</span>
        </form>
        {error && (
          <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    </li>
  )
}

function GoalPanel({
  year,
  goal,
  progress,
  isThisYear,
}: {
  year: number
  goal: number | undefined
  progress: ReturnType<typeof yearlyProgress>
  isThisYear: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const { read, percent, expected } = progress

  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await library.setGoal(year, value.trim() === '' ? null : Number(value))
      setEditing(false)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const pace =
    !goal || !isThisYear
      ? ''
      : read >= goal
        ? 'Goal reached!'
        : read > expected
          ? `${plural(read - expected, 'book')} ahead of schedule.`
          : read < expected
            ? `${plural(expected - read, 'book')} behind schedule.`
            : 'Right on schedule.'

  return (
    <section className={panel} aria-labelledby="goal">
      <h2 id="goal" className="text-sm font-semibold text-[var(--muted)]">
        {year} goal
      </h2>
      {goal ? (
        <>
          <p className="display-font mt-1 text-4xl font-semibold text-[var(--ink)]">
            {read} <span className="text-xl text-[var(--muted)]">of {plural(goal, 'book')}</span>
          </p>
          <div className="mt-2">
            <ProgressBar value={Math.min(read, goal)} max={goal} label={`${read} of ${goal} books, ${percent}%`} />
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {percent}%. {pace}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted)]">
          {plural(read, 'book')} finished. Set a goal to track how the year is going.
        </p>
      )}
      {editing ? (
        <form onSubmit={save} className="mt-2 flex items-center gap-2" noValidate>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Books
            <input
              className={`${field} w-24`}
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              data-autofocus
            />
          </label>
          <button type="submit" className={button}>
            Save
          </button>
          <button type="button" className="text-sm text-[var(--muted)] underline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="mt-2 text-sm text-[var(--muted)] underline"
          onClick={() => {
            setValue(goal ? String(goal) : '')
            setEditing(true)
          }}
        >
          {goal ? 'Change goal' : 'Set a goal'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  )
}

/**
 * Twelve monthly bars, one series in the accent color. Hovering or focusing a
 * bar shows its value; a visually hidden table carries the numbers for screen
 * readers.
 */
function MonthBars({
  title,
  unit,
  year,
  values,
}: {
  title: string
  unit: string
  year: number
  values: { month: string; value: number }[]
}) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...values.map((v) => v.value))
  const total = values.reduce((sum, v) => sum + v.value, 0)
  const shown = active === null ? null : values[active]

  return (
    <section className={panel} aria-label={`${title}, ${year}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--muted)]">{title}</h3>
        <p className="text-sm text-[var(--ink)]" aria-hidden>
          {shown ? `${MONTHS[active!]}: ${plural(shown.value, unit)}` : `${plural(total, unit)} in ${year}`}
        </p>
      </div>
      <div
        className="mt-3 flex h-28 items-end gap-[2px] border-b border-[var(--line-strong)]"
        aria-hidden
        onMouseLeave={() => setActive(null)}
      >
        {values.map((v, i) => (
          <div
            key={v.month}
            className="flex h-full flex-1 cursor-default items-end"
            onMouseEnter={() => setActive(i)}
            onTouchStart={() => setActive(i)}
          >
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{
                height: max ? `${(v.value / max) * 100}%` : 0,
                minHeight: v.value ? 2 : 0,
                background: 'var(--accent)',
                opacity: active === null || active === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-center text-[10px] text-[var(--muted)]" aria-hidden>
        {MONTHS.map((m) => (
          <span key={m} className="flex-1">
            {m[0]}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>
          {title} per month, {year}
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, i) => (
            <tr key={v.month}>
              <th scope="row">{MONTHS[i]}</th>
              <td>{v.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function TopList({ title, items, empty }: { title: string; items: Ranked[]; empty: string }) {
  const id = useId()
  return (
    <section className={panel} aria-labelledby={id}>
      <h3 id={id} className="text-sm font-semibold text-[var(--muted)]">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ol className="mt-2 grid gap-1">
          {items.map((item) => (
            <li key={item.name} className="flex justify-between gap-3 text-sm">
              <span className="truncate text-[var(--ink)]">{item.name}</span>
              <span className="shrink-0 text-[var(--muted)]">{plural(item.count, 'book')}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
