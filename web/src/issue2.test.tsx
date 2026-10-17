// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { library } from './library/useLibrary'
import { Library } from './Library'
import { Progress } from './Progress'
import { localDate } from './library/dates'

beforeEach(async () => {
  const backup = await library.exportAll()
  await library.importAll({ ...backup, books: [], shelves: [], progress: [], goals: {} }, 'replace')
})
afterEach(cleanup)
it('refreshes untouched progress and rejects a conflicting draft', async () => {
  const b = await library.addBook({ title: 'Live', status: 'reading', pages: 200, currentPage: 20 })
  render(<Progress />)
  const input = await screen.findByRole('spinbutton')
  await act(async () => { await library.logProgress(b.id, { page: 80 }) })
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('80'))
  fireEvent.change(input, { target: { value: '90' } })
  await act(async () => { await library.logProgress(b.id, { page: 100 }) })
  await waitFor(() => expect(screen.getAllByText('50%').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((await library.getBook(b.id))?.currentPage).toBe(100)
})
it('cancels a goal draft when navigating to another year', async () => {
  render(<Progress />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set a goal' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } })
  const year = Number(localDate().slice(0, 4))
  fireEvent.click(screen.getByRole('button', { name: 'Show ' + (year - 1) }))
  await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull())
  expect(await library.getGoal(year - 1)).toBeUndefined()
})
it('loads all books after the selected shelf is deleted', async () => {
  const shelf = await library.addShelf('Temporary')
  await library.addBook({ title: 'Visible', shelves: [shelf.id] })
  await library.addBook({ title: 'Other book' })
  render(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: 'Temporary' }))
  await waitFor(() => expect(screen.queryByText('Other book')).toBeNull())
  await act(async () => { await library.deleteShelf(shelf.id) })
  expect(await screen.findByText('Other book')).toBeTruthy()
  expect(screen.getByText('Visible')).toBeTruthy()
})
it.each(['Read', 'Reading'])('defaults dates for a new book added from %s', async status => {
  render(<Library />)
  fireEvent.click(await screen.findByRole('button', { name: status }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Add book' })[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Add by hand' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dated' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(async () => {
    const b = (await library.listBooks())[0]
    expect(status === 'Read' ? b?.finishedOn : b?.startedOn).toBe(localDate())
  })
})

