# shelfmark

Shelfmark: a private reading log on FreeAppStore — shelves (Want to read, Reading, Read, custom),
per-book dates, rating, notes and tags, Open Library search, ISBN barcode scan, progress, a yearly
goal and stats, JSON export/import and Goodreads CSV import. The library stays on the device
(IndexedDB, `web/src/library/store.ts`). Built so far: shelves and manual book entry (#231),
Open Library search (`web/src/library/openlibrary.ts`, #232), ISBN scan/validation
(`web/src/library/barcode.ts`, `isbn.ts`, #233);
the rest is listed under "Coming soon" on About; see freeappstore-online/platform#229.

- Live: https://shelfmark.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test` (vitest + fake-indexeddb; component tests opt into jsdom)
- Check: `fas check`
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API, the analytics loader and Open Library search/covers. Keep it that way.
- The library never leaves the device; only search queries go to Open Library.

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
