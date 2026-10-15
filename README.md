# Shelfmark

**A private reading log: shelves, progress and yearly goals, with Open Library
search and ISBN scan. Your library stays on your device.** A free app on
[FreeAppStore](https://freeappstore.online), live at https://shelfmark.freeappstore.online.

What it does: shelves (Want to read, Reading, Read and your own) and books with dates, a
rating, notes and tags, stored in IndexedDB on the device; add books from Open Library search
(title, author or ISBN, with covers), by scanning the ISBN barcode, or by hand; reading progress, a
streak, a yearly goal and monthly stats; JSON backup/restore and Goodreads CSV import. v1 was
tracked in [freeappstore-online/platform#229](https://github.com/freeappstore-online/platform/issues/229).

## Develop

```bash
pnpm install
pnpm dev      # local dev server
pnpm build    # production build in web/dist
fas check     # FreeAppStore compliance checks
```

Pushes to `main` auto-deploy via GitHub Actions.

## License

MIT.
