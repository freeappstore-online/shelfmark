// JSON backups: the whole library in one file the reader keeps. Reading a
// backup checks every record before anything is written, so a damaged or
// foreign file can't half-import.

import { ValidationError, isValidDate, normalizeBook } from './store'
import { type Book, type LibraryExport, type ProgressEntry, SCHEMA_VERSION, type Shelf } from './types'

export function serializeLibrary(data: LibraryExport): string {
  return `${JSON.stringify(data, null, 2)}\n`
}

/** shelfmark-2026-10-16.json */
export function backupFileName(date: string): string {
  return `shelfmark-${date}.json`
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTimestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * Parses and checks a backup made by exportAll, from this or an older schema
 * version. Throws ValidationError, with a message for the reader, on anything
 * that isn't a valid Shelfmark backup.
 */
export function parseLibraryJSON(text: string): LibraryExport {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new ValidationError("That file isn't a Shelfmark backup (it isn't JSON).")
  }
  if (!isObject(raw) || raw.app !== 'shelfmark') throw new ValidationError("That file isn't a Shelfmark backup.")
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("That backup's version is missing or not valid.")
  }
  if (version > SCHEMA_VERSION) {
    throw new ValidationError('That backup was made by a newer version of Shelfmark. Reload the app to update it, then try again.')
  }
  if (!Array.isArray(raw.books) || !Array.isArray(raw.shelves)) throw new ValidationError('That backup is missing its books or shelves.')
  // Schema 1 had no progress log or goals.
  const rawProgress = raw.progress ?? []
  const rawGoals = raw.goals ?? {}
  if (!Array.isArray(rawProgress) || !isObject(rawGoals)) throw new ValidationError("That backup's progress or goals are damaged.")

  const shelves: Shelf[] = []
  const shelfIds = new Set<string>()
  for (const [i, s] of raw.shelves.entries()) {
    const name = isObject(s) && typeof s.name === 'string' ? s.name.trim().replace(/\s+/g, ' ') : ''
    if (!isObject(s) || typeof s.id !== 'string' || !s.id || !name || name.length > 60 || !isTimestamp(s.createdAt)) {
      throw new ValidationError(`Shelf ${i + 1} in that backup is damaged.`)
    }
    if (shelfIds.has(s.id)) throw new ValidationError(`Shelf "${name}" appears twice in that backup.`)
    shelfIds.add(s.id)
    shelves.push({ id: s.id, name, createdAt: s.createdAt })
  }

  const books: Book[] = []
  const bookIds = new Set<string>()
  for (const [i, b] of raw.books.entries()) {
    const label = isObject(b) && typeof b.title === 'string' && b.title.trim() ? `"${b.title.trim()}"` : `${i + 1}`
    if (!isObject(b) || typeof b.id !== 'string' || !b.id || !isTimestamp(b.createdAt) || !isTimestamp(b.updatedAt)) {
      throw new ValidationError(`Book ${label} in that backup is damaged.`)
    }
    if (bookIds.has(b.id)) throw new ValidationError(`Book ${label} appears twice in that backup.`)
    if (!Array.isArray(b.shelves ?? []) || !Array.isArray(b.tags ?? [])) {
      throw new ValidationError(`Book ${label} in that backup is damaged.`)
    }
    try {
      books.push(normalizeBook(b as unknown as Book, shelfIds))
    } catch (err) {
      throw new ValidationError(`Book ${label} in that backup: ${(err as Error).message}`)
    }
    bookIds.add(b.id)
  }

  const progress: ProgressEntry[] = []
  const progressIds = new Set<string>()
  for (const [i, p] of rawProgress.entries()) {
    if (
      !isObject(p) ||
      typeof p.bookId !== 'string' ||
      !bookIds.has(p.bookId) ||
      typeof p.date !== 'string' ||
      !isValidDate(p.date) ||
      typeof p.pagesRead !== 'number' ||
      !Number.isInteger(p.pagesRead) ||
      p.pagesRead < 0 ||
      !isTimestamp(p.updatedAt)
    ) {
      throw new ValidationError(`Progress entry ${i + 1} in that backup is damaged.`)
    }
    const id = `${p.bookId}:${p.date}`
    if (progressIds.has(id)) throw new ValidationError(`Progress entry ${i + 1} in that backup is a duplicate.`)
    progressIds.add(id)
    progress.push({ id, bookId: p.bookId, date: p.date, pagesRead: p.pagesRead, updatedAt: p.updatedAt })
  }

  const goals: Record<string, number> = {}
  for (const [year, goal] of Object.entries(rawGoals)) {
    if (!/^\d{4}$/.test(year) || typeof goal !== 'number' || !Number.isInteger(goal) || goal < 1 || goal > 10_000) {
      throw new ValidationError(`The ${year} goal in that backup is not valid.`)
    }
    goals[year] = goal
  }

  return {
    app: 'shelfmark',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt)) ? raw.exportedAt : '',
    books,
    shelves,
    progress,
    goals,
  }
}
