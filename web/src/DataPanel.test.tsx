// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DataPanel } from './DataPanel'
import { library } from './library/useLibrary'

afterEach(cleanup)

const pick = (input: HTMLInputElement, name: string, text: string) =>
  fireEvent.change(input, { target: { files: [new File([text], name)] } })

describe('DataPanel', () => {
  it('says what stays on the device and what goes to Open Library', () => {
    render(<DataPanel />)
    expect(screen.getByText(/stored only on this device/)).toBeTruthy()
    expect(screen.getByText(/just the search goes to/)).toBeTruthy()
  })

  it('imports a Goodreads CSV picked from the device', async () => {
    const { container } = render(<DataPanel />)
    const csv = 'Title,Author,ISBN,ISBN13,My Rating,Exclusive Shelf,Bookshelves\n"Emma","Jane Austen","=""""","=""9780141439587""",5,read,classics\n'
    pick(container.querySelector('input[accept^=".csv"]')!, 'goodreads_library_export.csv', csv)
    expect((await screen.findByText(/Added 1 book from Goodreads/)).textContent).toContain('1 new shelf')
    expect((await library.listBooks()).map((b) => [b.title, b.rating, b.isbn])).toEqual([['Emma', 5, '9780141439587']])
  })

  it('shows why a file is not a backup', async () => {
    const { container } = render(<DataPanel />)
    pick(container.querySelector('input[accept^=".json"]')!, 'notes.json', '{"hello":1}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't a Shelfmark backup/)
  })
})
