// Themes (#236): the app follows the system's light or dark setting on first
// load (no flash: index.html sets it before paint), and the header toggle
// overrides it and is remembered.

import type { Page } from '@playwright/test'
import { expect, openApp, test } from './fixtures'

/** The theme the page resolved to, from its computed color-scheme (set by the theme tokens). */
const theme = (page: Page) =>
  page.evaluate(() => (getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light'))

test('follows the system theme, and the toggle overrides it', async ({ page }, info) => {
  const systemDark = info.project.use.colorScheme === 'dark'
  await openApp(page)
  expect(await theme(page)).toBe(systemDark ? 'dark' : 'light')

  // The toggle cycles system → light → dark.
  await page.getByRole('button', { name: 'Theme: system' }).click()
  await expect(page.getByRole('button', { name: 'Theme: light' })).toBeVisible()
  await expect.poll(() => theme(page)).toBe('light')
  await page.getByRole('button', { name: 'Theme: light' }).click()
  await expect(page.getByRole('button', { name: 'Theme: dark' })).toBeVisible()
  await expect.poll(() => theme(page)).toBe('dark')

  // Remembered across reloads.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Theme: dark' })).toBeVisible()
  expect(await theme(page)).toBe('dark')
})
