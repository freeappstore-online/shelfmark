import { describe, expect, it } from 'vitest'
import {
  cleanIsbn,
  isValidIsbn,
  isValidIsbn10,
  isValidIsbn13,
  isbn10To13,
  isbn13To10,
  isbnFromBarcode,
  parseIsbn,
  toIsbn13,
} from './isbn'

// Real pairs: Dune (Ace), The Hobbit (HarperCollins), a check-digit-X ISBN-10.
const PAIRS = [
  ['0441013597', '9780441013593'],
  ['0261102214', '9780261102217'],
  ['080442957X', '9780804429573'],
] as const

describe('ISBN-10', () => {
  it('accepts valid ISBN-10s, with hyphens, spaces and a lower-case x', () => {
    for (const [ten] of PAIRS) expect(isValidIsbn10(ten)).toBe(true)
    expect(isValidIsbn10('0-441-01359-7')).toBe(true)
    expect(isValidIsbn10('0 8044 2957 x')).toBe(true)
  })

  it('rejects a wrong check digit, a misplaced X, wrong length and non-digits', () => {
    expect(isValidIsbn10('0441013598')).toBe(false)
    expect(isValidIsbn10('X441013597')).toBe(false)
    expect(isValidIsbn10('044101359')).toBe(false)
    expect(isValidIsbn10('04410135977')).toBe(false)
    expect(isValidIsbn10('04410a3597')).toBe(false)
    expect(isValidIsbn10('')).toBe(false)
  })

  it('catches swapped adjacent digits', () => {
    expect(isValidIsbn10('4041013597')).toBe(false)
  })
})

describe('ISBN-13', () => {
  it('accepts valid 978 and 979 ISBN-13s', () => {
    for (const [, thirteen] of PAIRS) expect(isValidIsbn13(thirteen)).toBe(true)
    expect(isValidIsbn13('978-0-441-01359-3')).toBe(true)
    expect(isValidIsbn13('9791032305690')).toBe(true)
  })

  it('rejects a wrong check digit, non-book EANs and wrong lengths', () => {
    expect(isValidIsbn13('9780441013594')).toBe(false)
    // A valid EAN-13 for a non-book product (checksum fine, prefix not 978/979).
    expect(isValidIsbn13('4006381333931')).toBe(false)
    expect(isValidIsbn13('978044101359')).toBe(false)
    expect(isValidIsbn13('97804410135933')).toBe(false)
    expect(isValidIsbn13('978044101359X')).toBe(false)
  })

  it('isValidIsbn takes either form', () => {
    expect(isValidIsbn('0441013597')).toBe(true)
    expect(isValidIsbn('9780441013593')).toBe(true)
    expect(isValidIsbn('1234567890')).toBe(false)
  })
})

describe('conversion', () => {
  it('converts ISBN-10 to ISBN-13 and back', () => {
    for (const [ten, thirteen] of PAIRS) {
      expect(isbn10To13(ten)).toBe(thirteen)
      expect(isbn13To10(thirteen)).toBe(ten)
    }
    expect(isbn10To13('0-8044-2957-x')).toBe('9780804429573')
  })

  it('refuses invalid input, and 979 ISBNs have no ISBN-10', () => {
    expect(isbn10To13('0441013598')).toBeUndefined()
    expect(isbn13To10('9780441013594')).toBeUndefined()
    expect(isbn13To10('9791032305690')).toBeUndefined()
  })

  it('normalizes to compact and ISBN-13 forms', () => {
    expect(cleanIsbn(' 0-8044-2957-x ')).toBe('080442957X')
    expect(parseIsbn('0-441-01359-7')).toBe('0441013597')
    expect(parseIsbn('978-0-441-01359-3')).toBe('9780441013593')
    expect(parseIsbn('0441013598')).toBeUndefined()
    expect(toIsbn13('0-441-01359-7')).toBe('9780441013593')
    expect(toIsbn13('9780441013593')).toBe('9780441013593')
    expect(toIsbn13('dune')).toBeUndefined()
  })
})

describe('isbnFromBarcode', () => {
  it('reads a book EAN-13, ignoring a price add-on', () => {
    expect(isbnFromBarcode('9780441013593')).toBe('9780441013593')
    expect(isbnFromBarcode('978044101359351699')).toBe('9780441013593')
    expect(isbnFromBarcode('978044101359312')).toBe('9780441013593')
  })

  it("ignores barcodes that aren't books", () => {
    expect(isbnFromBarcode('4006381333931')).toBeUndefined()
    expect(isbnFromBarcode('9780441013594')).toBeUndefined()
    expect(isbnFromBarcode('012345678905')).toBeUndefined()
    expect(isbnFromBarcode('')).toBeUndefined()
  })
})
