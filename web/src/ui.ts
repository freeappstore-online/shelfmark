// Shared Tailwind class strings for the app's controls. Colours come from the
// theme tokens in index.css, so light and dark each get their own contrast-
// checked pairs (--button-*).

export const button =
  'rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--panel-strong)]'
export const primaryButton =
  'rounded-[var(--radius-sm)] bg-[var(--button-bg)] px-4 py-2 text-sm font-semibold text-[var(--button-ink)] hover:opacity-90'
export const dangerButton =
  'rounded-[var(--radius-sm)] bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--button-ink)] hover:opacity-90'
export const field =
  'w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)]'
