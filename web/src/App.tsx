import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'

const fas = initApp({ appId: 'shelfmark' })

// The app's screens. Shell renders them as its navbar (<nav aria-label="Main">,
// current screen highlighted, a menu on phones). `title` becomes the browser
// tab title on that route.
const NAV: NavItem[] = [
  { label: 'Library', href: '/', title: 'Shelfmark' },
  { label: 'About', href: '/about', title: 'About — Shelfmark' },
]

// The features planned for v1 (freeappstore-online/platform#229).
const FEATURES = [
  { name: 'Shelves', what: 'Want to read, Reading and Read, plus shelves of your own.' },
  { name: 'Your books', what: 'Dates, a star rating, notes and tags for every book.' },
  { name: 'Find books', what: 'Search Open Library by title, author or ISBN, with covers.' },
  { name: 'Scan ISBN', what: "Scan a book's barcode with your camera, or type the ISBN." },
  { name: 'Progress & goals', what: 'Pages read, a reading streak, a yearly goal and monthly stats.' },
  { name: 'Private', what: 'Your library stays on your device. Import from Goodreads; export any time.' },
]

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)

  // Keep the screen in step with the browser's back and forward buttons.
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Nav clicks switch screens without a page load. Shell scrolls to the top
  // and moves focus to the new screen's PageHeader.
  const navigate = (href: string) => {
    window.history.pushState(null, '', href)
    setPath(href)
  }

  return (
    <Shell app={fas} appName="Shelfmark" nav={NAV} onNavigate={navigate}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">{path === '/about' ? <About /> : <Library />}</div>
      <BuildInfo />
    </Shell>
  )
}

function Library() {
  return (
    <>
      <PageHeader
        title="Shelfmark"
        description="Coming soon — a private reading log: shelves, progress and yearly goals, with Open Library search and ISBN scan. Your library stays on your device."
      />
      <ComingSoon />
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <li key={feature.name} className="rounded-[var(--radius)] border border-[var(--line)] p-4">
            <p className="font-semibold text-[var(--ink)]">{feature.name}</p>
            <p className="text-sm text-[var(--muted)]">{feature.what}</p>
          </li>
        ))}
      </ul>
    </>
  )
}

function About() {
  return (
    <>
      <PageHeader title="About" />
      <ComingSoon />
      <p className="mt-4 text-[var(--muted)]">
        Shelfmark will be a simple log of the books you want to read, are reading and have read. Your
        library will be kept on your device, with no account needed; only book searches will go to
        Open Library. No ads.
      </p>
      <p className="mt-4 text-[var(--muted)]">
        Shelfmark is a free, MIT-licensed app on{' '}
        <a href="https://freeappstore.online" className="underline">
          FreeAppStore
        </a>
        .
      </p>
    </>
  )
}

// Placeholder until the features are built. None of them work yet, so it says so plainly.
function ComingSoon() {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4 text-[var(--muted)]">
      Coming soon. Shelfmark is in development; the features below aren't available yet.
    </p>
  )
}
