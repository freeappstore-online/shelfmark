import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Modal } from '@freeappstore/sdk/ui'
import { type IsbnDetector, type ScanEnvironment, createIsbnDetector, scanForIsbn } from './library/barcode'
import { toIsbn13 } from './library/isbn'
import { button, primaryButton, field } from './ui'

const SCAN_INTERVAL_MS = 200


type Camera =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'blocked' }
  | { kind: 'failed' }

/**
 * Reads a book's ISBN: from its barcode with the camera where the browser can
 * scan, and by typing it everywhere. Hands back an ISBN-13.
 */
export function IsbnScanner({
  onIsbn,
  onClose,
  env,
}: {
  onIsbn: (isbn13: string) => void
  onClose: () => void
  /** For tests; defaults to the browser's globals. */
  env?: ScanEnvironment
}) {
  const [camera, setCamera] = useState<Camera>({ kind: 'checking' })
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  // The latest callback, so the scan loop doesn't restart when the parent re-renders.
  const found = useRef(onIsbn)
  found.current = onIsbn

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const loop = async (detector: IsbnDetector) => {
      if (stopped) return
      const v = video.current
      if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const isbn = await scanForIsbn(detector, v)
        if (isbn && !stopped) {
          stopped = true
          navigator.vibrate?.(40)
          found.current(isbn)
          return
        }
      }
      timer = setTimeout(() => loop(detector), SCAN_INTERVAL_MS)
    }

    ;(async () => {
      const detector = await createIsbnDetector(env)
      if (stopped) return
      if (!detector) return setCamera({ kind: 'unsupported' })
      setCamera({ kind: 'starting' })
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
      } catch (err) {
        if (stopped) return
        const name = (err as { name?: string })?.name
        return setCamera({ kind: name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'failed' })
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      video.current.srcObject = stream
      await video.current.play().catch(() => {})
      setCamera({ kind: 'scanning' })
      loop(detector)
    })()

    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [env])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const isbn = toIsbn13(typed)
    if (!isbn) return setError("That isn't a valid ISBN. Check the 10 or 13 digits, usually above the barcode.")
    found.current(isbn)
  }

  const showVideo = camera.kind === 'starting' || camera.kind === 'scanning'

  return (
    <Modal open onClose={onClose} title="Scan ISBN" maxWidth={480}>
      {showVideo && (
        <div className="relative overflow-hidden rounded-[var(--radius)] bg-black">
          <video ref={video} className="aspect-[4/3] w-full object-cover" playsInline muted aria-label="Camera" />
          {/* A guide for where to hold the barcode. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-md border-2 border-white/80"
          />
        </div>
      )}
      <p className="mt-2 text-sm text-[var(--muted)]" aria-live="polite">
        {camera.kind === 'checking' && 'Checking for a camera…'}
        {camera.kind === 'starting' && 'Starting the camera…'}
        {camera.kind === 'scanning' &&
          "Hold the barcode on the back of the book inside the frame. It's read on this device."}
        {camera.kind === 'unsupported' && "This browser can't scan barcodes. Type the ISBN instead."}
        {camera.kind === 'blocked' &&
          'Camera access is off for this site. Allow it in your browser settings, or type the ISBN.'}
        {camera.kind === 'failed' && "Couldn't start the camera. Type the ISBN instead."}
      </p>

      <form onSubmit={submit} className="mt-3 grid gap-2" noValidate>
        <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
          ISBN
          <input
            className={`${field} font-normal`}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value)
              setError('')
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="978-0-441-01359-3"
            aria-invalid={error ? true : undefined}
            data-autofocus={camera.kind === 'scanning' ? undefined : true}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButton}>
            Look up
          </button>
        </div>
      </form>
    </Modal>
  )
}
