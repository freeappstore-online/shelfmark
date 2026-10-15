// Offline (#236): after the first load the service worker serves the app, and
// the library (IndexedDB) works without a network. Search says it's offline
// and points to adding by hand.

import { addByHand, books, expect, go, openApp, test, waitForServiceWorker } from './fixtures'

test('the library works offline after the first load', async ({ page, context }) => {
  await openApp(page)
  await addByHand(page, { title: 'Middlemarch', author: 'George Eliot', shelf: 'Reading', pages: '880' })
  await waitForServiceWorker(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(books(page)).toHaveCount(1)

  // Search can't run, and says so.
  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await expect(search.getByText("You're offline, so search isn't available")).toBeVisible()
  await search.getByLabel('Search Open Library').fill('piranesi')
  await expect(search.getByText(/offline/)).toBeVisible()
  await search.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('dialog', { name: 'Add book', exact: true })
  await form.getByLabel('Title').fill('Written offline')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(books(page)).toHaveCount(2)

  // Still offline: every screen loads and the new book is still there after a reload.
  await page.reload()
  await expect(books(page).filter({ hasText: 'Written offline' })).toHaveCount(1)
  await go(page, 'Progress')
  await expect(page.getByRole('listitem').filter({ hasText: 'Middlemarch' })).toBeVisible()
  await go(page, 'About')
  await expect(page.getByRole('heading', { name: 'Your privacy' })).toBeVisible()
  await context.setOffline(false)
})
