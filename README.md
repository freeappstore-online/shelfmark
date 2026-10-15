# Shelfmark

**Coming soon — a private reading log: shelves, progress and yearly goals, with Open Library
search and ISBN scan. Your library stays on your device.** A free app on
[FreeAppStore](https://freeappstore.online), live at https://shelfmark.freeappstore.online.

Right now this is a shell: it lists the planned features, but none of them work yet. Progress is
tracked in
[freeappstore-online/platform#229](https://github.com/freeappstore-online/platform/issues/229).

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
