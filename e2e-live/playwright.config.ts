import { defineConfig, devices } from '@playwright/test'

// Live checks (freeappstore-online/platform#237): the deployed app at phone
// width, light and dark, against the real Open Library. Every test runs in a
// fresh browser profile, so no one's library is touched. Run: `pnpm e2e:live`.

export const LIVE_URL = process.env.SHELFMARK_URL ?? 'https://shelfmark.freeappstore.online'

const phone = { ...devices['iPhone 13'], defaultBrowserType: 'chromium' as const, viewport: { width: 375, height: 812 } }

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 1,
  workers: 2,
  reporter: 'list',
  use: { baseURL: LIVE_URL, trace: 'retain-on-failure', locale: 'en-GB', timezoneId: 'Europe/London' },
  projects: [
    { name: 'phone-light', use: { ...phone, colorScheme: 'light' } },
    { name: 'phone-dark', use: { ...phone, colorScheme: 'dark' } },
  ],
})
