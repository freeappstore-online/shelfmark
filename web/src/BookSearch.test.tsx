// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const { search } = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock('./library/openlibrary', async original => ({ ...await original<typeof import('./library/openlibrary')>(), createSearchClient: () => ({ search }) }))
import { BookSearch } from './BookSearch'
afterEach(() => { cleanup(); vi.useRealTimers(); search.mockReset() })
it('ignores an old response during the next query debounce', async () => {
  vi.useFakeTimers()
  let resolve!: (value: unknown[]) => void
  search.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  render(<BookSearch onPick={() => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'old' } })
  await act(async () => { vi.advanceTimersByTime(350) })
  const signal = search.mock.calls[0][2] as AbortSignal
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve([{ key: '/works/OL1W', title: 'OLD RESULT', authors: [] }]) })
  expect(screen.queryByText('OLD RESULT')).toBeNull()
})
