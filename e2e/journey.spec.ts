// The main journeys (#236): add a book by hand and from (mocked) Open Library
// search, shelve and edit it, note progress against a goal, and back the
// library up and restore it.

import { readFile } from 'node:fs/promises'
import { TODAY, addByHand, books, expect, go, openApp, test } from './fixtures'

test('add by hand and from search, shelve, edit and delete', async ({ page, openLibrary }) => {
  await openApp(page)
  await expect(page.getByText('No books yet')).toBeVisible()

  await addByHand(page, { title: 'Middlemarch', author: 'George Eliot', shelf: 'Reading', pages: '880' })
  await expect(books(page)).toHaveCount(1)

  // From search: results come from the mocked Open Library, with a cover.
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await search.getByLabel('Search Open Library').fill('piranesi')
  await search.getByRole('button', { name: /^Piranesi Susanna Clarke · 2020/ }).click()
  const form = page.getByRole('dialog', { name: 'Add book', exact: true })
  await expect(form.getByLabel('Title')).toHaveValue('Piranesi')
  await expect(form.getByLabel('Author')).toHaveValue('Susanna Clarke')
  await expect(form.getByLabel('ISBN')).toHaveValue('9781635575637')
  await expect(form.getByLabel('Pages')).toHaveValue('272')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
  await expect(books(page)).toHaveCount(2)
  await expect(books(page).filter({ hasText: 'Piranesi' }).locator('img')).toHaveAttribute('src', /covers\.openlibrary\.org\/b\/id\/10520611-S\.jpg/)
  expect(new URL(openLibrary[0]).searchParams.get('q')).toBe('piranesi')

  // A shelf of our own.
  await page.getByRole('button', { name: 'Edit shelves' }).click()
  const shelves = page.getByRole('dialog', { name: 'Your shelves' })
  await shelves.getByLabel('New shelf name').fill('Book club')
  await shelves.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(shelves.getByLabel('Rename Book club')).toBeVisible()
  await shelves.getByRole('button', { name: 'Done' }).click()

  // Finish Piranesi: Read (today's date fills in), 4½ stars, on Book club, tagged.
  await books(page).filter({ hasText: 'Piranesi' }).getByRole('button').click()
  const edit = page.getByRole('dialog', { name: 'Edit book' })
  await edit.getByLabel('Shelf', { exact: true }).selectOption({ label: 'Read' })
  await expect(edit.getByLabel('Finished')).toHaveValue(TODAY)
  await edit.getByLabel('Rating').selectOption('4.5')
  await edit.getByLabel('Book club').check()
  await edit.getByLabel('Tags (separated by commas)').fill('fantasy, short')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()

  const shelf = page.getByRole('group', { name: 'Shelf' })
  await shelf.getByRole('button', { name: 'Book club' }).click()
  await expect(books(page)).toHaveCount(1)
  await expect(books(page).first()).toContainText('Piranesi')
  await expect(books(page).first()).toContainText('#fantasy')
  await expect(books(page).first().getByLabel('4.5 out of 5 stars')).toBeVisible()
  await shelf.getByRole('button', { name: 'Reading', exact: true }).click()
  await expect(books(page)).toHaveCount(1)
  await expect(books(page).first()).toContainText('Middlemarch')

  // Survives a reload.
  await page.reload()
  await expect(books(page)).toHaveCount(2)

  // Delete Middlemarch.
  await books(page).filter({ hasText: 'Middlemarch' }).getByRole('button').click()
  await page.getByRole('dialog', { name: 'Edit book' }).getByRole('button', { name: 'Delete book' }).click()
  await page.getByRole('dialog', { name: 'Delete this book?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(books(page)).toHaveCount(1)
  await expect(books(page).first()).toContainText('Piranesi')
})

test('look up a typed ISBN (the scanner fallback)', async ({ page, openLibrary }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await search.getByRole('button', { name: 'Scan ISBN' }).click()
  const scanner = page.getByRole('dialog', { name: 'Scan ISBN' })
  // Headless Chromium has no BarcodeDetector, so this is the typed path every browser has.
  await expect(scanner.getByText(/Type the ISBN|Camera|Checking/).first()).toBeVisible()
  await scanner.getByLabel('ISBN').fill('978-1-63557-563-8')
  await scanner.getByRole('button', { name: 'Look up' }).click()
  await expect(scanner.getByRole('alert')).toContainText("isn't a valid ISBN")
  await scanner.getByLabel('ISBN').fill('1-63557-563-x')
  await scanner.getByRole('button', { name: 'Look up' }).click()
  await expect(scanner).toBeHidden()
  await expect(search.getByLabel('Search by')).toHaveValue('isbn')
  await expect(search.getByRole('button', { name: /^Piranesi Susanna Clarke/ })).toBeVisible()
  expect(new URL(openLibrary.at(-1)!).searchParams.get('isbn')).toBe('9781635575637')
})

test('progress, streak and yearly goal', async ({ page }) => {
  await openApp(page)
  await addByHand(page, { title: 'Middlemarch', author: 'George Eliot', shelf: 'Reading', pages: '880' })
  await addByHand(page, { title: 'Emma', author: 'Jane Austen', shelf: 'Read', pages: '400' })

  await go(page, 'Progress')
  const row = page.getByRole('listitem').filter({ hasText: 'Middlemarch' })
  await row.getByRole('spinbutton').fill('220')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.getByText('25%').first()).toBeVisible()
  await expect(page.getByText('1 day', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Set a goal' }).click()
  await page.getByLabel('Books', { exact: true }).fill('12')
  await page.getByRole('button', { name: 'Save' }).last().click()
  await expect(page.getByText('of 12 books', { exact: true })).toBeVisible()
  await expect(page.getByText(/^8%\./)).toBeVisible()

  // Emma finished today (400 pages) plus 220 logged.
  await expect(page.getByText('620 pages in 2026')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Top authors' })).toContainText('Jane Austen')

  await page.reload()
  await expect(page.getByText('of 12 books', { exact: true })).toBeVisible()
})

test('export a backup, restore it, and import from Goodreads', async ({ page }) => {
  await openApp(page)
  await addByHand(page, { title: 'Middlemarch', author: 'George Eliot', shelf: 'Reading' })
  await addByHand(page, { title: 'Emma', author: 'Jane Austen', shelf: 'Read' })

  await go(page, 'About')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe(`shelfmark-${TODAY}.json`)
  const backup = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(backup).toMatchObject({ app: 'shelfmark', schemaVersion: 2 })
  expect(backup.books).toHaveLength(2)

  // Lose a book, then restore the backup over the library.
  await go(page, 'Library')
  await books(page).filter({ hasText: 'Emma' }).getByRole('button').click()
  await page.getByRole('dialog', { name: 'Edit book' }).getByRole('button', { name: 'Delete book' }).click()
  await page.getByRole('dialog', { name: 'Delete this book?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(books(page)).toHaveCount(1)

  await go(page, 'About')
  await page.locator('input[accept^=".json"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const confirm = page.getByRole('dialog', { name: 'Import this backup?' })
  await expect(confirm).toContainText('2 books')
  await confirm.getByRole('button', { name: 'Replace my library' }).click()
  await expect(page.getByText(/^Restored 2 books/)).toBeVisible()

  // Goodreads: one new book, one already in the library.
  const csv = [
    'Title,Author,ISBN,ISBN13,My Rating,Date Read,Bookshelves,Exclusive Shelf',
    '"Emma","Jane Austen","=""""","=""""",5,2024/03/01,,read',
    '"Persuasion","Jane Austen","=""0141439688""","=""9780141439686""",4,2024/04/02,"classics",read',
  ].join('\n')
  await page.locator('input[accept^=".csv"]').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText(/^Added 1 book from Goodreads/)).toContainText('1 book already in your library skipped')

  await go(page, 'Library')
  await expect(books(page)).toHaveCount(3)
  await expect(books(page).filter({ hasText: 'Persuasion' })).toContainText('classics')
})
