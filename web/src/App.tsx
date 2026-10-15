import { useEffect, useState } from 'react'
import { initApp } from '@freeappstore/sdk'
import { BuildInfo, type NavItem, PageHeader, Shell } from '@freeappstore/sdk/ui'
import { DataPanel } from './DataPanel'
import { Library } from './Library'
import { Progress } from './Progress'

const fas = initApp({ appId: 'shelfmark' })

// The app's screens. Shell renders them as its navbar (<nav aria-label="Main">,
// current screen highlighted, a menu on phones). `title` becomes the browser
// tab title on that route.
const NAV: NavItem[] = [
  { label: 'Library', href: '/', title: 'Shelfmark' },
  { label: 'Progress', href: '/progress', title: 'Progress — Shelfmark' },
  { label: 'About', href: '/about', title: 'About — Shelfmark' },
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
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">{path === '/about' ? <About /> : path === '/progress' ? <Progress /> : <Library />}</div>
      <BuildInfo />
    </Shell>
  )
}

function About() {
  return (
    <>
      <PageHeader title="About" />
      <p className="mt-4 text-[var(--muted)]">
        Shelfmark is a simple log of the books you want to read, are reading and have read: shelves of
        your own, dates, a star rating, notes and tags. Your library is kept on this device, with no
        account needed. Find books on Open Library by title, author or ISBN, scan a book's barcode,
        or add them by hand. Note your page to keep a reading streak, set a yearly goal and see your
        books and pages per month and your top authors and tags. Bring your Goodreads library
        with you, and back everything up to a file. No ads.
      </p>
      <DataPanel />
      <p className="mt-6 text-[var(--muted)]">
        Shelfmark is a free, MIT-licensed app on{' '}
        <a href="https://freeappstore.online" className="underline">
          FreeAppStore
        </a>
        .
      </p>
    </>
  )
}
