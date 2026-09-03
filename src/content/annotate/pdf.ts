/**
 * A minimal PDF writer for captures.
 *
 * Hand-written rather than bundled: a PDF whose every page is one image is a
 * few hundred bytes of structure, and the smallest general-purpose PDF library
 * is larger than Hotshot's entire editor chunk. It also keeps the promise that
 * a reviewer can read this repository and see that nothing leaves the machine
 * — there is no encoder here to audit beyond arithmetic.
 *
 * Pages carry JPEG data through `/DCTDecode`, which is the one image filter a
 * PDF can take verbatim. PNG would need Flate with predictors re-encoded, for
 * a file several times the size on screenshot content.
 */

export interface PdfPage {
  /** Raw JPEG bytes, embedded without re-encoding. */
  readonly jpeg: Uint8Array
  readonly widthPx: number
  readonly heightPx: number
}

export interface PdfOptions {
  /**
   * Pixels per inch used to size the page. 96 is the CSS reference, so a
   * capture prints at the size it appeared on screen.
   */
  readonly dpi?: number | undefined
  /** Shown in the document properties; never a URL or page content. */
  readonly title?: string | undefined
}

const DEFAULT_DPI = 96
const POINTS_PER_INCH = 72

/** PDF numbers: fixed precision, and never `1e-7` or `NaN`. */
function num(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`A PDF measurement must be finite, got ${value}`)
  }
  return (Math.round(value * 100) / 100).toString()
}

/**
 * Escapes a PDF text string.
 *
 * The title is the only place page-derived text reaches the file, and an
 * unescaped `)` there would truncate the object and corrupt every byte offset
 * after it.
 */
function pdfString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // Keep it to printable ASCII: PDFDocEncoding for anything else is a
    // rabbit hole, and a mangled title is worse than a plain one.
    .replace(/[^\x20-\x7e]/g, '?')
  return `(${escaped})`
}

export function buildPdf(pages: readonly PdfPage[], options: PdfOptions = {}): Uint8Array {
  if (pages.length === 0) throw new RangeError('A PDF needs at least one page.')

  const dpi = options.dpi ?? DEFAULT_DPI
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError(`dpi must be a positive finite number, got ${dpi}`)
  }

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0

  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }

  /** Byte offset of each object, indexed by object number. */
  const offsets: number[] = []
  const objectCount = 2 + pages.length * 3

  const beginObject = (id: number): void => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }
  const endObject = (): void => push('endobj\n')

  // A binary comment on line 2 tells every downstream tool this file is not
  // text, which is what stops a gateway mangling the JPEGs. Written as RAW
  // bytes: through a TextEncoder each of these becomes a two-byte UTF-8
  // sequence and the marker stops being high-bit at all.
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  const pageIds = pages.map((_, i) => 3 + i * 3)

  beginObject(1)
  push(`<< /Type /Catalog /Pages 2 0 R >>\n`)
  endObject()

  beginObject(2)
  push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\n`,
  )
  endObject()

  for (const [index, page] of pages.entries()) {
    if (page.widthPx <= 0 || page.heightPx <= 0) {
      throw new RangeError(
        `Page ${index + 1} has no area (${page.widthPx}x${page.heightPx}); nothing to draw.`,
      )
    }

    const pageId = pageIds[index] as number
    const contentId = pageId + 1
    const imageId = pageId + 2
    const widthPt = (page.widthPx * POINTS_PER_INCH) / dpi
    const heightPt = (page.heightPx * POINTS_PER_INCH) / dpi

    beginObject(pageId)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(widthPt)} ${num(heightPt)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\n`,
    )
    endObject()

    // The image is drawn to fill the page exactly: scale by the page size,
    // translate to the origin. PDF's origin is bottom-left, and a full-bleed
    // image needs no flip because the transform maps the unit square onto it.
    const content = `q\n${num(widthPt)} 0 0 ${num(heightPt)} 0 0 cm\n/Im0 Do\nQ\n`
    beginObject(contentId)
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`)
    push(content)
    push('endstream\n')
    endObject()

    beginObject(imageId)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpeg.length} >>\nstream\n`,
    )
    push(page.jpeg)
    push('\nendstream\n')
    endObject()
  }

  const infoId = objectCount + 1
  beginObject(infoId)
  push(`<< /Producer (Hotshot) /Title ${pdfString(options.title ?? 'Capture')} >>\n`)
  endObject()

  // The cross-reference table. Every offset here is the position recorded
  // while writing, which is why the writer tracks length rather than
  // concatenating first and searching afterwards.
  const xrefOffset = length
  const total = infoId + 1
  push(`xref\n0 ${total}\n`)
  push('0000000000 65535 f \n')
  for (let id = 1; id < total; id++) {
    const offset = offsets[id]
    if (offset === undefined) throw new Error(`Object ${id} was never written.`)
    push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoId} 0 R >>\n`)
  push(`startxref\n${xrefOffset}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
