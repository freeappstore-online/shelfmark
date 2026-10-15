// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Progress } from './Progress'
import { addDays, localDate } from './library/dates'
import { library } from './library/useLibrary'

afterEach(cleanup)

describe('Progress page', () => {
  it('shows reading books, the streak, the goal and the year’s stats from the library', async () => {
    const today = localDate()
    const year = Number(today.slice(0, 4))
    const reading = await library.addBook({ title: 'Middlemarch', author: 'George Eliot', pages: 800 })
    await library.logProgress(reading.id, { page: 100 }, addDays(today, -1))
    await library.logProgress(reading.id, { page: 200 }, today)
    await library.addBook({ title: 'Emma', author: 'Jane Austen', status: 'read', finishedOn: today, pages: 400, tags: ['classic'] })
    await library.setGoal(year, 10)

    render(<Progress />)
    expect(await screen.findByText('Middlemarch')).toBeTruthy()
    expect(screen.getByText('2 days')).toBeTruthy()
    expect(screen.getByText('of 10 books')).toBeTruthy()
    expect(screen.getByText('Jane Austen')).toBeTruthy()
    expect(screen.getByText('classic')).toBeTruthy()
    // 200 logged pages plus Emma's 400.
    expect(screen.getByText(`600 pages in ${year}`)).toBeTruthy()

    // Saving a new page updates the bar's percent.
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '400' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await waitFor(() => expect(screen.getAllByText('50%').length).toBeGreaterThan(0))
  })
})
