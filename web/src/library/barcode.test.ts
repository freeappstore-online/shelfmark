import { describe, expect, it, vi } from 'vitest'
import { type IsbnDetector, createIsbnDetector, scanForIsbn } from './barcode'

const camera = { mediaDevices: { getUserMedia: () => Promise.reject(new Error('unused')) } }

/** A stand-in for the browser's BarcodeDetector class. */
function fakeDetectorClass(formats: string[]) {
  const ctor = vi.fn(function (this: { options: unknown }, options: unknown) {
    this.options = options
  }) as unknown as { getSupportedFormats: () => Promise<string[]> }
  ctor.getSupportedFormats = async () => formats
  return ctor
}

describe('createIsbnDetector', () => {
  it('returns undefined without BarcodeDetector (Safari, Firefox)', async () => {
    expect(await createIsbnDetector({ navigator: camera })).toBeUndefined()
  })

  it('returns undefined when EAN-13 is not supported or there is no camera API', async () => {
    expect(await createIsbnDetector({ BarcodeDetector: fakeDetectorClass(['qr_code']), navigator: camera })).toBeUndefined()
    expect(await createIsbnDetector({ BarcodeDetector: fakeDetectorClass(['ean_13']), navigator: {} })).toBeUndefined()
  })

  it('returns undefined if asking for formats throws', async () => {
    const ctor = fakeDetectorClass([])
    ctor.getSupportedFormats = () => Promise.reject(new Error('no'))
    expect(await createIsbnDetector({ BarcodeDetector: ctor, navigator: camera })).toBeUndefined()
  })

  it('creates an EAN-13 detector where supported', async () => {
    const ctor = fakeDetectorClass(['qr_code', 'ean_13'])
    const detector = await createIsbnDetector({ BarcodeDetector: ctor, navigator: camera })
    expect(detector).toBeDefined()
    expect(ctor).toHaveBeenCalledWith({ formats: ['ean_13'] })
  })
})

describe('scanForIsbn', () => {
  const frame = {} as ImageBitmapSource
  const detecting = (values: string[]): IsbnDetector => ({ detect: async () => values.map((rawValue) => ({ rawValue })) })

  it('returns the first book barcode in the frame', async () => {
    expect(await scanForIsbn(detecting(['4006381333931', '9780441013593']), frame)).toBe('9780441013593')
  })

  it('returns undefined for no barcode, a non-book barcode, or a detector error', async () => {
    expect(await scanForIsbn(detecting([]), frame)).toBeUndefined()
    expect(await scanForIsbn(detecting(['4006381333931']), frame)).toBeUndefined()
    const failing: IsbnDetector = { detect: () => Promise.reject(new DOMException('not ready', 'InvalidStateError')) }
    expect(await scanForIsbn(failing, frame)).toBeUndefined()
  })
})
