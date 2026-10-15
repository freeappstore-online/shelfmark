// Camera ISBN scanning with the Shape Detection API's BarcodeDetector, where
// the browser has it (Chrome on Android, some desktops; not Safari or Firefox
// today). Everything runs on the device; frames are never uploaded.

import { isbnFromBarcode } from './isbn'

/** The part of BarcodeDetector we use. */
export interface IsbnDetector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>
}

interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): IsbnDetector
  getSupportedFormats?: () => Promise<string[]>
}

/** Where to look for the APIs; a parameter so tests can stand in for the browser. */
export interface ScanEnvironment {
  BarcodeDetector?: unknown
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
}

/**
 * A detector for book barcodes (EAN-13), or undefined when this browser can't
 * scan: no BarcodeDetector, no EAN-13 support, or no camera API. Callers fall
 * back to typing the ISBN.
 */
export async function createIsbnDetector(env: ScanEnvironment = globalThis as ScanEnvironment): Promise<IsbnDetector | undefined> {
  const Detector = env.BarcodeDetector as BarcodeDetectorCtor | undefined
  if (typeof Detector !== 'function' || typeof env.navigator?.mediaDevices?.getUserMedia !== 'function') return undefined
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? []
    if (!formats.includes('ean_13')) return undefined
    return new Detector({ formats: ['ean_13'] })
  } catch {
    return undefined
  }
}

/** The ISBN-13 in a frame, if the detector sees a book barcode. Detection errors count as "nothing yet". */
export async function scanForIsbn(detector: IsbnDetector, source: ImageBitmapSource): Promise<string | undefined> {
  try {
    for (const code of await detector.detect(source)) {
      const isbn = isbnFromBarcode(code.rawValue)
      if (isbn) return isbn
    }
  } catch {
    // A frame that isn't ready yet, or a transient decoder error; try the next one.
  }
  return undefined
}
