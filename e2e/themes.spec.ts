// Themes (#236): the app follows the system's light or dark setting on first
// load (no flash: index.html sets it before paint), and the theme choice on
// the SDK's Profile page (header avatar) overrides it and is remembered.

import type { Page } from '@playwright/test'
import { expect, openApp, test } from './fixtures'

/** The theme the page resolved to, from its computed color-scheme (set by the theme tokens). */
const theme = (page: Page) =>
  page.evaluate(() => (getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'dark' : 'light'))

test('follows the system theme, and the toggle overrides it', async ({ page }, info) => {
  const systemDark = info.project.use.colorScheme === 'dark'
  await openApp(page)
  expect(await theme(page)).toBe(systemDark ? 'dark' : 'light')

  // SDK 0.17: the theme choice lives on the built-in Profile page.
  await page.getByRole('link', { name: 'Profile', exact: true }).click()
  const choice = (name: string) => page.getByRole('button', { name, exact: true })
  await choice('Light').click()
  await expect(choice('Light')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => theme(page)).toBe('light')
  await choice('Dark').click()
  await expect(choice('Dark')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => theme(page)).toBe('dark')

  // Remembered across reloads.
  await page.reload()
  await expect(choice('Dark')).toHaveAttribute('aria-pressed', 'true')
  expect(await theme(page)).toBe('dark')
})
