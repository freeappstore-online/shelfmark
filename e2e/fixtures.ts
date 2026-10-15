// Shared e2e setup. Every test gets:
//   - a privacy guard: fails if any request (page or service worker) goes to a
//     host other than the app, the *.freeappstore.online platform, the
//     Cloudflare Web Analytics beacon the platform edge injects on the live
//     host, or Open Library search and covers (disclosed on About);
//   - Open Library mocked, so tests never touch the real service;
//   - a fixed "today" (2026-10-15) so dates and streaks are stable.

import { type Page, test as base, expect } from '@playwright/test'

export const TODAY = '2026-10-15'

const PLATFORM_THIRD_PARTY = new Set(['static.cloudflareinsights.com'])

export function isAllowedRequest(url: string, appOrigin: string): boolean {
  const u = new URL(url)
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true
  if (u.origin === appOrigin) return true
  if (u.protocol !== 'https:') return false
  if (u.hostname === 'openlibrary.org') return u.pathname === '/search.json'
  if (u.hostname === 'covers.openlibrary.org') return u.pathname.startsWith('/b/id/')
  return u.hostname === 'freeappstore.online' || u.hostname.endsWith('.freeappstore.online') || PLATFORM_THIRD_PARTY.has(u.hostname)
}

/** What Open Library would return for "piranesi" (only the fields the app asks for). */
export const SEARCH_RESULTS = {
  docs: [
    {
      key: '/works/OL20893680W',
      title: 'Piranesi',
      author_name: ['Susanna Clarke'],
      first_publish_year: 2020,
      isbn: ['9781635575637', '163557563X'],
      cover_i: 10520611,
      number_of_pages_median: 272,
    },
    { key: '/works/OL1W', title: 'Piranesi: The Etchings', author_name: ['G. B. Piranesi'] },
  ],
}

// A 1×1 PNG, served for every cover.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC',
  'base64',
)

export const test = base.extend<{ openLibrary: string[]; privacyGuard: void; fixedToday: void }>({
  // Mocks Open Library; the value is the list of search URLs the app requested.
  openLibrary: [
    async ({ context }, use) => {
      const searches: string[] = []
      await context.route('https://openlibrary.org/search.json*', (route) => {
        searches.push(route.request().url())
        const q = new URL(route.request().url()).searchParams
        const term = (q.get('q') ?? q.get('title') ?? q.get('isbn') ?? '').toLowerCase()
        const hit = term.includes('piranesi') || term === '9781635575637'
        return route.fulfill({ json: hit ? SEARCH_RESULTS : { docs: [] }, headers: { 'access-control-allow-origin': '*' } })
      })
      await context.route('https://covers.openlibrary.org/**', (route) =>
        route.fulfill({ body: PNG, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }),
      )
      await use(searches)
    },
    { auto: true },
  ],
  privacyGuard: [
    async ({ context, baseURL }, use) => {
      const offenders: string[] = []
      context.on('request', (r) => {
        if (!isAllowedRequest(r.url(), new URL(baseURL!).origin)) offenders.push(r.url())
      })
      await use()
      expect(offenders, 'requests to hosts other than the app, the platform and Open Library search/covers').toEqual([])
    },
    { auto: true },
  ],
  fixedToday: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`))
      await use()
    },
    { auto: true },
  ],
})

export { expect }

export type Screen = 'Library' | 'Progress' | 'About'

/** Opens a screen from the main nav (through the menu on phones). */
export async function go(page: Page, name: Screen) {
  const nav = page.getByRole('navigation', { name: 'Main' })
  const link = () => nav.getByRole('link', { name, exact: true }).filter({ visible: true })
  if ((await link().count()) === 0) await nav.getByRole('button', { name: 'Menu' }).click()
  await link().click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

/** Adds a book through Add book → Add by hand. */
export async function addByHand(page: Page, fields: { title: string; author?: string; shelf?: string; pages?: string }) {
  await page.getByRole('button', { name: 'Add book' }).first().click()
  await page.getByRole('dialog', { name: 'Add a book' }).getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByRole('dialog', { name: 'Add book' })
  await form.getByLabel('Title').fill(fields.title)
  if (fields.author) await form.getByLabel('Author').fill(fields.author)
  if (fields.shelf) await form.getByLabel('Shelf', { exact: true }).selectOption({ label: fields.shelf })
  if (fields.pages) await form.getByLabel('Pages').fill(fields.pages)
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toBeHidden()
}

/** The book cards in the library list. */
export const books = (page: Page) => page.getByRole('main').getByRole('list').last().getByRole('listitem')

/** Waits until the service worker controls the page (so the app works offline). */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  }
}
