// ISBN-10 and ISBN-13: check digits and conversion between the two.
// https://www.isbn-international.org/content/isbn-users-manual

/** Strips spaces and hyphens and upper-cases a trailing x. Doesn't validate. */
export function cleanIsbn(text: string): string {
  return text.replace(/[\s-]/g, '').toUpperCase()
}

/** The check character (0-9 or X) for the first 9 digits of an ISBN-10. */
function isbn10CheckDigit(first9: string): string {
  let sum = 0
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(first9[i])
  const check = (11 - (sum % 11)) % 11
  return check === 10 ? 'X' : String(check)
}

/** The check digit for the first 12 digits of an ISBN-13 (EAN-13). */
function isbn13CheckDigit(first12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1)
  return String((10 - (sum % 10)) % 10)
}

/** Whether the text (hyphens and spaces allowed) is an ISBN-10 with a correct check digit. */
export function isValidIsbn10(text: string): boolean {
  const s = cleanIsbn(text)
  return /^\d{9}[\dX]$/.test(s) && isbn10CheckDigit(s) === s[9]
}

/** Whether the text is an ISBN-13: 978 or 979 (the book prefixes) and a correct check digit. */
export function isValidIsbn13(text: string): boolean {
  const s = cleanIsbn(text)
  return /^97[89]\d{10}$/.test(s) && isbn13CheckDigit(s) === s[12]
}

export function isValidIsbn(text: string): boolean {
  return isValidIsbn10(text) || isValidIsbn13(text)
}

/** ISBN-10 → ISBN-13 (978 prefix). Undefined if the input isn't a valid ISBN-10. */
export function isbn10To13(text: string): string | undefined {
  if (!isValidIsbn10(text)) return undefined
  const first12 = `978${cleanIsbn(text).slice(0, 9)}`
  return first12 + isbn13CheckDigit(first12)
}

/** ISBN-13 → ISBN-10. Only 978 ISBNs have one; undefined otherwise. */
export function isbn13To10(text: string): string | undefined {
  if (!isValidIsbn13(text)) return undefined
  const s = cleanIsbn(text)
  if (!s.startsWith('978')) return undefined
  const first9 = s.slice(3, 12)
  return first9 + isbn10CheckDigit(first9)
}

/** A valid ISBN in its compact form (as typed: 10 or 13), or undefined. */
export function parseIsbn(text: string): string | undefined {
  const s = cleanIsbn(text)
  return isValidIsbn(s) ? s : undefined
}

/** A valid ISBN as ISBN-13, or undefined. */
export function toIsbn13(text: string): string | undefined {
  const s = cleanIsbn(text)
  return isValidIsbn13(s) ? s : isbn10To13(s)
}

/**
 * The ISBN-13 in a scanned barcode value, or undefined if it isn't a book's.
 * A book's barcode is an EAN-13 starting 978/979, sometimes followed by a
 * 2- or 5-digit price add-on that scanners may append.
 */
export function isbnFromBarcode(rawValue: string): string | undefined {
  const digits = rawValue.replace(/\D/g, '')
  if (![13, 15, 18].includes(digits.length)) return undefined
  const ean = digits.slice(0, 13)
  return isValidIsbn13(ean) ? ean : undefined
}
