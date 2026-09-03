import { describe, expect, test } from 'vitest'
import { buildPdf, type PdfPage } from './pdf'

/**
 * A PDF is only valid if its cross-reference offsets are byte-exact, and a
 * reader given a wrong offset shows a blank document rather than an error. So
 * the offsets are checked against the bytes themselves rather than trusted.
 */

const decoder = new TextDecoder('latin1')

/** Stands in for JPEG data: a real SOI/EOI wrapper around filler. */
function jpeg(size = 64): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0)
  bytes.set([0xff, 0xd9], size - 2)
  // Include a byte sequence that would break a naive text-based writer.
  bytes.set([0x28, 0x29, 0x5c, 0x0a], 8)
  return bytes
}

function page(over: Partial<PdfPage> = {}): PdfPage {
  return { jpeg: jpeg(), widthPx: 800, heightPx: 600, ...over }
}

function text(pdf: Uint8Array): string {
  return decoder.decode(pdf)
}

/** Reads the xref table back and checks each offset lands on its object. */
function assertXrefIsExact(pdf: Uint8Array): void {
  const body = text(pdf)
  const startxref = body.lastIndexOf('startxref')
  expect(startxref, 'no startxref').toBeGreaterThan(-1)

  const xrefOffset = Number.parseInt(body.slice(startxref + 9).trim(), 10)
  expect(body.slice(xrefOffset, xrefOffset + 4)).toBe('xref')

  const header = body.slice(xrefOffset).match(/xref\n0 (\d+)\n/)
  expect(header, 'malformed xref header').not.toBeNull()
  const count = Number.parseInt((header as RegExpMatchArray)[1] as string, 10)

  // Entry 0 is the mandatory free entry; objects start at index 1.
  const entries = body
    .slice(xrefOffset + (header as RegExpMatchArray)[0].length)
    .split('\n')
    .slice(1, count)

  expect(entries).toHaveLength(count - 1)
  entries.forEach((entry, index) => {
    const offset = Number.parseInt(entry.slice(0, 10), 10)
    const id = index + 1
    expect(
      body.slice(offset, offset + `${id} 0 obj`.length),
      `xref entry for object ${id} points at the wrong byte`,
    ).toBe(`${id} 0 obj`)
  })
}

describe('buildPdf', () => {
  test('writes a PDF header and an EOF marker', () => {
    const pdf = buildPdf([page()])
    expect(text(pdf).startsWith('%PDF-1.4')).toBe(true)
    expect(text(pdf).trimEnd().endsWith('%%EOF')).toBe(true)
  })

  test('marks the file as binary so gateways do not mangle the JPEGs', () => {
    const pdf = buildPdf([page()])
    // Line 2 is a comment carrying four high bytes — the convention every PDF
    // uses to declare itself binary.
    const secondLine = pdf.subarray('%PDF-1.4\n'.length)
    expect(secondLine[0]).toBe(0x25) // '%'
    expect([...secondLine.subarray(1, 5)].every((byte) => byte > 127)).toBe(true)
  })

  test('cross-reference offsets are byte-exact for a single page', () => {
    assertXrefIsExact(buildPdf([page()]))
  })

  test('cross-reference offsets are byte-exact for many pages', () => {
    assertXrefIsExact(buildPdf([page(), page(), page(), page(), page()]))
  })

  /**
   * The specific failure this guards: JPEG payloads contain bytes that look
   * like PDF syntax. If the writer measured offsets on a re-encoded string
   * instead of the bytes it emitted, they would drift by exactly the number of
   * non-ASCII bytes in the images.
   */
  test('offsets stay exact when image data contains PDF syntax bytes', () => {
    const hostile = new Uint8Array(256)
    for (let i = 0; i < hostile.length; i++) hostile[i] = i
    assertXrefIsExact(buildPdf([page({ jpeg: hostile }), page({ jpeg: hostile })]))
  })

  test('declares one page object per page, and counts them', () => {
    const pdf = text(buildPdf([page(), page(), page()]))
    expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(3)
    expect(pdf).toContain('/Count 3')
  })

  test('every page is listed in the page tree', () => {
    const pdf = text(buildPdf([page(), page()]))
    const kids = pdf.match(/\/Kids \[([^\]]+)\]/)
    expect(kids).not.toBeNull()
    expect((kids as RegExpMatchArray)[1]?.trim().split(' 0 R').filter(Boolean)).toHaveLength(2)
  })

  test('embeds the image bytes verbatim, without re-encoding', () => {
    const data = jpeg(128)
    const pdf = buildPdf([page({ jpeg: data })])
    const needle = decoder.decode(data)
    expect(text(pdf)).toContain(needle)
    expect(text(pdf)).toContain('/Filter /DCTDecode')
    expect(text(pdf)).toContain(`/Length ${data.length}`)
  })

  test('sizes the page so a capture prints at its on-screen size', () => {
    // 96px per inch in, 72pt per inch out: 800px is 600pt.
    const pdf = text(buildPdf([page({ widthPx: 800, heightPx: 600 })]))
    expect(pdf).toContain('/MediaBox [0 0 600 450]')
  })

  test('honours an explicit dpi, which is how a print-size export works', () => {
    const pdf = text(buildPdf([page({ widthPx: 300, heightPx: 300 })], { dpi: 300 }))
    expect(pdf).toContain('/MediaBox [0 0 72 72]')
  })

  test('draws the image across the whole page', () => {
    const pdf = text(buildPdf([page({ widthPx: 960, heightPx: 480 })]))
    expect(pdf).toContain('720 0 0 360 0 0 cm')
    expect(pdf).toContain('/Im0 Do')
  })

  test('pages of different sizes each get their own MediaBox', () => {
    const pdf = text(
      buildPdf([page({ widthPx: 960, heightPx: 480 }), page({ widthPx: 480, heightPx: 960 })]),
    )
    expect(pdf).toContain('/MediaBox [0 0 720 360]')
    expect(pdf).toContain('/MediaBox [0 0 360 720]')
  })

  test('escapes a title so it cannot truncate the object', () => {
    const pdf = text(buildPdf([page()], { title: 'Invoice (final) \\ draft' }))
    expect(pdf).toContain('(Invoice \\(final\\) \\\\ draft)')
    assertXrefIsExact(buildPdf([page()], { title: 'Invoice (final) \\ draft' }))
  })

  test('replaces non-ASCII title characters rather than emitting raw bytes', () => {
    const pdf = text(buildPdf([page()], { title: 'Отчёт' }))
    expect(pdf).toContain('/Title (?????)')
  })

  test('refuses a document with no pages', () => {
    expect(() => buildPdf([])).toThrow(RangeError)
  })

  test.each([
    [{ widthPx: 0, heightPx: 100 }],
    [{ widthPx: 100, heightPx: 0 }],
    [{ widthPx: -10, heightPx: 100 }],
  ])('refuses a page with no area (%j)', (size) => {
    expect(() => buildPdf([page(size)])).toThrow(/no area/)
  })

  test.each([0, -96, Number.NaN, Number.POSITIVE_INFINITY])('refuses a nonsense dpi (%s)', (dpi) => {
    expect(() => buildPdf([page()], { dpi })).toThrow(RangeError)
  })

  test('the trailer size matches the number of objects written', () => {
    const pdf = text(buildPdf([page(), page()]))
    // 1 catalog + 1 page tree + 3 per page + 1 info + 1 free entry.
    expect(pdf).toContain('/Size 10')
    expect(pdf).toContain('/Root 1 0 R')
  })
})
