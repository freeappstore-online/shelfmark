// Accessibility (#236): axe on every screen and dialog, with data, in light
// and dark, on desktop and phone: no serious or critical WCAG 2.1 AA issues.
//
// The SDK Shell's header (platform-owned: the "Free" logo link and "Sign in"
// button in the platform accent) is excluded, as in the other FreeAppStore
// apps: apps may not override brand colours (fas check: "No brand
// overrides"). Its result is recorded as an annotation instead.

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { addByHand, books, expect, go, openApp, test } from './fixtures'

async function expectNoSeriousViolations(page: Page, label: string) {
  // Let dialog fade-ins finish (not endless ones like spinners): mid-animation
  // colours are partly transparent and read as low contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('#root > div > header')
    .analyze()
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
  expect(serious, `axe on ${label}`).toEqual([])
}

test('platform header (recorded, not gated)', async ({ page }) => {
  await openApp(page)
  const results = await new AxeBuilder({ page }).include('#root > div > header').withTags(['wcag2aa']).analyze()
  test.info().annotations.push({
    type: 'platform-a11y',
    description: results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join('; ') || 'none',
  })
})

test('every screen and dialog', async ({ page }) => {
  await openApp(page)
  await expectNoSeriousViolations(page, 'empty library')

  await addByHand(page, { title: 'Middlemarch', author: 'George Eliot', shelf: 'Reading', pages: '880' })
  await addByHand(page, { title: 'Emma', author: 'Jane Austen', shelf: 'Read', pages: '400' })
  await expectNoSeriousViolations(page, 'library')

  await page.getByRole('button', { name: 'Add book' }).first().click()
  const search = page.getByRole('dialog', { name: 'Add a book' })
  await search.getByLabel('Search Open Library').fill('piranesi')
  await expect(search.getByRole('button', { name: /^Piranesi/ }).first()).toBeVisible()
  await expectNoSeriousViolations(page, 'search')
  await search.getByRole('button', { name: 'Scan ISBN' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan ISBN' }).getByLabel('ISBN')).toBeVisible()
  await expectNoSeriousViolations(page, 'ISBN scanner')
  await page.getByRole('dialog', { name: 'Scan ISBN' }).getByRole('button', { name: 'Cancel' }).click()
  await search.getByRole('button', { name: 'Cancel' }).click()

  await books(page).filter({ hasText: 'Emma' }).getByRole('button').click()
  await expect(page.getByRole('dialog', { name: 'Edit book' })).toBeVisible()
  await expectNoSeriousViolations(page, 'book form')
  await page.getByRole('dialog', { name: 'Edit book' }).getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Edit shelves' }).click()
  await expectNoSeriousViolations(page, 'shelves')
  await page.getByRole('dialog', { name: 'Your shelves' }).getByRole('button', { name: 'Done' }).click()

  await go(page, 'Progress')
  await expectNoSeriousViolations(page, 'progress')
  await go(page, 'About')
  await expectNoSeriousViolations(page, 'about')
})
