// Live checks against the deployed app (#237), at 375px in light and dark,
// with the real Open Library. Each check records what it saw as an annotation.

import { type Page, test as base, expect } from '@playwright/test'

/** Hosts the app may contact, as disclosed on About. Open Library serves some covers from archive.org (its parent). */
function hostAllowed(url: URL, app: string): boolean {
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === app) return true
  if (url.protocol !== 'https:') return false
  const h = url.hostname
  if (h === 'openlibrary.org') return url.pathname === '/search.json'
  return (
    h === 'covers.openlibrary.org' ||
    h === 'archive.org' ||
    h.endsWith('.archive.org') ||
    h === 'freeappstore.online' ||
    h.endsWith('.freeappstore.online') ||
    h === 'static.cloudflareinsights.com'
  )
}

const test = base.extend<{ hosts: Set<string> }>({
  hosts: [
    async ({ context, baseURL }, use, info) => {
      const app = new URL(baseURL!).origin
      const hosts = new Set<string>()
      const bad: string[] = []
      context.on('request', (r) => {
        const u = new URL(r.url())
        if (u.origin !== app && u.protocol.startsWith('http')) hosts.add(u.hostname)
        if (!hostAllowed(u, app)) bad.push(r.url())
      })
      await use(hosts)
      info.annotations.push({ type: 'third-party hosts', description: [...hosts].sort().join(', ') || 'none' })
      expect(bad, 'requests to undisclosed hosts').toEqual([])
    },
    { auto: true },
  ],
})

const note = (text: string) => test.info().annotations.push({ type: 'evidence', description: text })

async function open(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
  expect(scheme).toBe(test.info().project.use.colorScheme === 'dark' ? 'dark' : 'light')
  // No document scroll at phone width.
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(fits, 'no horizontal scroll at 375px').toBe(true)
}

async function go(page: Page, name: 'Library' | 'Progress' | 'About') {
  const nav = page.getByRole('navigation', { name: 'Main' })
  const link = () => nav.getByRole('link', { name, exact: true }).filter({ visible: true })
  if ((await link().count()) === 0) await nav.getByRole('button', { name: 'Menu' }).click()
  await link().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function addByHand(page: Page, title: string, shelf: 'Want to read' | 'Reading' | 'Read', author = '') {
  await page.getByRole('button', { name: 'Add book' }).first().click()
  await page.getByRole('dialog', { name: 'Add a book' }).getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('dialog', { name: 'Add book', exact: true })
  await form.getByLabel('Title').fill(title)
  if (author) await form.getByLabel('Author').fill(author)
  await form.getByLabel('Shelf', { exact: true }).selectOption({ label: shelf })
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
}

const cards = (page: Page) => page.getByRole('main').getByRole('list').last().getByRole('listitem')

test('search: Open Library by title, with a cover', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await search.getByLabel('Search Open Library').fill('piranesi susanna clarke')
  const hit = search.getByRole('button', { name: /^Piranesi Susanna Clarke/ }).first()
  await expect(hit).toBeVisible()
  await hit.click()
  const form = page.getByRole('dialog', { name: 'Add book', exact: true })
  await expect(form.getByLabel('Title')).toHaveValue('Piranesi')
  const isbn = await form.getByLabel('ISBN').inputValue()
  await form.getByRole('button', { name: 'Save' }).click()
  const card = cards(page).filter({ hasText: 'Piranesi' })
  await expect(card).toBeVisible()
  // The cover comes through Open Library's redirects to the Internet Archive; give it time to load.
  const img = card.locator('img')
  await expect(img).toHaveCount(1)
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 1), { timeout: 30_000 })
    .toBe(true)
  const size = await img.evaluate((i: HTMLImageElement) => `${i.naturalWidth}×${i.naturalHeight}`)
  note(`search "piranesi susanna clarke" → added Piranesi (ISBN ${isbn || 'none'}), cover loaded (${size}) from ${await img.getAttribute('src')}`)
})

test('ISBN: typed fallback looks the book up on Open Library', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await search.getByRole('button', { name: 'Scan ISBN' }).click()
  const scanner = page.getByRole('dialog', { name: 'Scan ISBN' })
  const status = await scanner.getByText(/Checking|can't scan|Camera|camera/).first().textContent()
  await scanner.getByLabel('ISBN').fill('0-441-01359-7')
  await scanner.getByRole('button', { name: 'Look up' }).click()
  await expect(scanner).toBeHidden()
  await expect(search.getByLabel('Search Open Library')).toHaveValue('9780441013593')
  await expect(search.getByRole('button', { name: /Dune/ }).first()).toBeVisible()
  note(`scanner said "${status?.trim()}"; typed ISBN-10 0-441-01359-7 → ISBN-13 9780441013593 → Dune found`)
})

test('shelves: custom shelf, assign, filter, survives reload', async ({ page }) => {
  await open(page)
  await addByHand(page, 'Middlemarch', 'Reading', 'George Eliot')
  await addByHand(page, 'Emma', 'Read', 'Jane Austen')
  await page.getByRole('button', { name: 'Edit shelves' }).click()
  const shelves = page.getByRole('dialog', { name: 'Your shelves' })
  await shelves.getByLabel('New shelf name').fill('Book club')
  await shelves.getByRole('button', { name: 'Add', exact: true }).click()
  await shelves.getByRole('button', { name: 'Done' }).click()
  await cards(page).filter({ hasText: 'Emma' }).getByRole('button').click()
  const edit = page.getByRole('dialog', { name: 'Edit book' })
  await edit.getByLabel('Book club').check()
  await edit.getByRole('button', { name: 'Save' }).click()
  await page.reload()
  const filter = page.getByRole('group', { name: 'Shelf' })
  await filter.getByRole('button', { name: 'Book club' }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('Emma')
  await filter.getByRole('button', { name: 'Reading', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(cards(page).first()).toContainText('Middlemarch')
  note('2 books on built-in shelves + custom "Book club"; filters correct after reload')
})

test('goal: yearly goal and reading progress', async ({ page }) => {
  await open(page)
  await addByHand(page, 'Emma', 'Read', 'Jane Austen')
  await addByHand(page, 'Middlemarch', 'Reading', 'George Eliot')
  await go(page, 'Progress')
  await page.getByRole('button', { name: 'Set a goal' }).click()
  await page.getByLabel('Books', { exact: true }).fill('12')
  await page.getByRole('button', { name: 'Save' }).last().click()
  await expect(page.getByText('of 12 books', { exact: true })).toBeVisible()
  const year = new Date().getFullYear()
  await expect(page.getByRole('heading', { name: `${year} goal` })).toBeVisible()
  await page.reload()
  await expect(page.getByText('of 12 books', { exact: true })).toBeVisible()
  const goal = await page.getByRole('region', { name: `${year} goal` }).innerText()
  note(`goal set to 12 and kept after reload: "${goal.replace(/\s+/g, ' ').trim()}"`)
})

test('Goodreads: CSV import adds books, shelves and ratings', async ({ page }) => {
  await open(page)
  await go(page, 'About')
  await expect(page.getByRole('heading', { name: 'Your privacy' })).toBeVisible()
  const csv = [
    'Book Id,Title,Author,ISBN,ISBN13,My Rating,Date Read,Bookshelves,Exclusive Shelf',
    '1,"The Hobbit","J.R.R. Tolkien","=""0261102214""","=""9780261102217""",5,2024/03/01,"classics, favourites",read',
    '2,"Dune","Frank Herbert","=""""","=""""",0,,,to-read',
  ].join('\n')
  await page.locator('input[accept^=".csv"]').setInputFiles({ name: 'goodreads_library_export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const result = page.getByText(/^Added 2 books from Goodreads/)
  await expect(result).toBeVisible()
  const message = await result.textContent()
  await go(page, 'Library')
  await expect(cards(page)).toHaveCount(2)
  const hobbit = cards(page).filter({ hasText: 'The Hobbit' })
  await expect(hobbit.getByLabel('5 out of 5 stars')).toBeVisible()
  await expect(hobbit).toContainText('classics')
  note(`"${message}"; The Hobbit on Read with 5 stars and shelves classics/favourites; Dune on Want to read`)
})

test('offline: the library works after the first load', async ({ page, context }) => {
  await open(page)
  await addByHand(page, 'Middlemarch', 'Reading', 'George Eliot')
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  }
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(cards(page).filter({ hasText: 'Middlemarch' })).toBeVisible()
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await expect(search.getByText(/offline/)).toBeVisible()
  await search.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('dialog', { name: 'Add book', exact: true })
  await form.getByLabel('Title').fill('Added offline')
  await form.getByRole('button', { name: 'Save' }).click()
  await page.reload()
  await expect(cards(page)).toHaveCount(2)
  await go(page, 'Progress')
  await go(page, 'About')
  await context.setOffline(false)
  note('service worker controls the page; offline reload shows the library; search says offline; added a book offline and it persisted; Progress and About load offline')
})
