import { type DependencyList, useEffect, useState } from 'react'
import { type LibraryStore, createLibraryStore } from './store'

/** The app's one store. Opens IndexedDB lazily, on the first read or write. */
export const library: LibraryStore = createLibraryStore()

/**
 * Loads data from the store and reloads it after every write (in this tab or
 * another), so screens stay current. Undefined until the first load finishes.
 */
export function useLibrary<T>(load: (store: LibraryStore) => Promise<T>, deps: DependencyList = []): T | undefined {
  const [value, setValue] = useState<T>()

  useEffect(() => {
    let cancelled = false
    let run = 0
    const reload = () => {
      const current = ++run
      load(library).then(
        (v) => {
          if (!cancelled && current === run) setValue(() => v)
        },
        (err: unknown) => console.error('Shelfmark: loading the library failed', err),
      )
    }
    reload()
    const unsubscribe = library.subscribe(reload)
    return () => {
      cancelled = true
      unsubscribe()
    }
    // `load` is usually an inline arrow; callers list what it depends on in `deps`.
  }, deps)

  return value
}
