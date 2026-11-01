// Shared Tailwind class strings for the app's controls. Colours come from the
// theme tokens in index.css, so light and dark each get their own contrast-
// checked pairs (--button-*).

export const button =
  'rounded-fas-sm border border-line-strong px-3 py-2 text-sm font-semibold text-ink hover:bg-panel-strong'
export const primaryButton =
  'rounded-fas-sm bg-[var(--button-bg)] px-4 py-2 text-sm font-semibold text-button-ink hover:opacity-90'
export const dangerButton =
  'rounded-fas-sm bg-danger px-4 py-2 text-sm font-semibold text-button-ink hover:opacity-90'
export const field =
  'w-full rounded-fas-sm border border-line-strong bg-paper px-3 py-2 text-ink'
