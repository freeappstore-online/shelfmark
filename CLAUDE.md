# shelfmark

Shelfmark: a private reading log on FreeAppStore — shelves (Want to read, Reading, Read, custom),
per-book dates, rating, notes and tags, Open Library search, ISBN barcode scan, progress, a yearly
goal and stats, JSON export/import and Goodreads CSV import. The library stays on the device
(IndexedDB, `web/src/library/store.ts`). v1 (freeappstore-online/platform#229) is built: shelves and
manual entry (#231), Open Library search (`web/src/library/openlibrary.ts`, #232), ISBN scan/validation
(`barcode.ts`, `isbn.ts`, #233), progress/goal/stats (`stats.ts`, #234), privacy note, JSON backup
(`backup.ts`) and Goodreads import (`goodreads.ts`, #235). Bump `SCHEMA_VERSION` (types.ts) for any
store change; `parseLibraryJSON` must keep reading older backups.

- Live: https://shelfmark.freeappstore.online
- Dev: `pnpm install && pnpm dev`
- Build: `pnpm build`
- Test: `pnpm test` (vitest + fake-indexeddb; component tests opt into jsdom)
- E2E: `pnpm build && pnpm e2e` (Playwright: desktop + phone, light + dark; Open Library mocked)
- Check: `fas check` and `fas screencheck --skip-build` (no document scroll: `main.fas-main` scrolls)
- Deploy: `git push origin main` (auto-deploys to R2 via GitHub Actions)

## Notes

- Fonts are self-hosted (`@fontsource-variable/*`); the app makes no third-party requests
  beyond the platform API, the analytics loader and Open Library search/covers (covers redirect to
  archive.org, disclosed on About). Keep it that way. Live checks: `pnpm e2e:live` (real site and Open Library).
- The library never leaves the device; only search queries go to Open Library.

Platform conventions: https://raw.githubusercontent.com/freeappstore-online/freeappstore/main/SKILLS.md
