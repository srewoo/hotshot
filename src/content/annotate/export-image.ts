import { buildPdf, type PdfPage } from './pdf'
import {
  extensionFor,
  fitWithinBytes,
  mimeFor,
  type EncodeStep,
  type FitOutcome,
  type ImageFormat,
} from './export-plan'

/**
 * Applying an export plan to a canvas (PRD FR-39, §7 attachment limits).
 *
 * The thin, browser-bound half of `export-plan.ts`: it scales, encodes, and
 * slices. Every decision it makes came from there, so this file has no
 * branching worth testing in isolation — it is verified through the browser,
 * where `toBlob` and JPEG encoding are real.
 */

export type ExportKind = ImageFormat | 'pdf'

/** JPEG default: high enough that screenshot text stays crisp. */
export const DEFAULT_JPEG_QUALITY = 0.92

/**
 * A4 at 96 CSS px per inch, portrait.
 *
 * Long captures are sliced to this so a 9,000px page prints as a readable
 * sequence rather than one absurdly tall sheet no printer will accept.
 */
export const A4_PAGE = { widthPx: 794, heightPx: 1123 } as const

function encode(canvas: HTMLCanvasElement, format: ImageFormat, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The capture could not be encoded.'))),
      mimeFor(format),
      quality,
    )
  })
}

/** Draws the source onto a new canvas at `scale`. */
function rescale(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  if (scale === 1) return source
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(source.width * scale))
  target.height = Math.max(1, Math.round(source.height * scale))
  const context = target.getContext('2d')
  if (!context) throw new Error('Could not acquire a 2D context to resize the capture.')
  // Best-quality downscale: the default is a single bilinear step, which on a
  // screenshot of text turns strokes into grey mush.
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, target.width, target.height)
  return target
}

export async function encodeStep(canvas: HTMLCanvasElement, step: EncodeStep): Promise<Blob> {
  return encode(rescale(canvas, step.scale), step.format, step.quality)
}

export interface FittedExport {
  readonly blob: Blob
  /** What was given up to fit, or null. Never silent. */
  readonly note: string | null
}

/**
 * Encodes the capture as large as the limit allows.
 *
 * Called before shipping to a destination whose attachment limit a full-page
 * capture would otherwise breach — a 413 after annotating is the worst place
 * to discover the file is too big (FR-32).
 */
export async function fitForUpload(
  canvas: HTMLCanvasElement,
  limitBytes: number,
): Promise<FittedExport> {
  // Cache per step: the search encodes to measure, and encoding a
  // 100-megapixel canvas twice is seconds of wasted work.
  const encoded = new Map<EncodeStep, Blob>()

  const outcome: FitOutcome | null = await fitWithinBytes(limitBytes, async (step) => {
    const blob = await encodeStep(canvas, step)
    encoded.set(step, blob)
    return blob.size
  })

  if (!outcome) {
    throw new Error(
      `This capture is too large for the destination's ${Math.round(limitBytes / 1_000_000)} MB limit, even reduced. Download it and attach it by hand.`,
    )
  }

  const blob = encoded.get(outcome.step)
  if (!blob) throw new Error('The capture could not be encoded for upload.')
  return { blob, note: outcome.note }
}

/**
 * Slices a tall capture into page-sized strips.
 *
 * Slicing on the pixel grid rather than scaling the whole capture down keeps
 * text at its captured size, which is the difference between a PDF someone can
 * read and one they can only look at.
 */
export function slicePages(
  canvas: HTMLCanvasElement,
  pageHeightPx: number,
): readonly HTMLCanvasElement[] {
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) {
    throw new RangeError(`pageHeightPx must be a positive finite number, got ${pageHeightPx}`)
  }
  if (canvas.height <= pageHeightPx) return [canvas]

  const pages: HTMLCanvasElement[] = []
  for (let top = 0; top < canvas.height; top += pageHeightPx) {
    const height = Math.min(pageHeightPx, canvas.height - top)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = height
    const context = slice.getContext('2d')
    if (!context) throw new Error('Could not acquire a 2D context to slice the capture.')
    // White behind the slice: a JPEG has no alpha, and a transparent capture
    // would otherwise composite to black in the PDF.
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, slice.width, height)
    context.drawImage(canvas, 0, -top)
    pages.push(slice)
  }
  return pages
}

/**
 * Builds a multi-page PDF from the capture.
 *
 * Page height is derived from the capture's own width so the aspect ratio of
 * an A4 sheet is preserved: a wide capture gets proportionally shorter pages
 * rather than being squeezed.
 */
export async function exportPdf(
  canvas: HTMLCanvasElement,
  options: { readonly title?: string | undefined; readonly quality?: number | undefined } = {},
): Promise<Blob> {
  const pageHeight = Math.round(canvas.width * (A4_PAGE.heightPx / A4_PAGE.widthPx))
  const slices = slicePages(canvas, pageHeight)

  const pages: PdfPage[] = []
  for (const slice of slices) {
    const blob = await encode(slice, 'jpeg', options.quality ?? DEFAULT_JPEG_QUALITY)
    pages.push({
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      widthPx: slice.width,
      heightPx: slice.height,
    })
  }

  // Sized at the capture's own device resolution, so a DPR-2 capture prints
  // at half the pixel dimensions and twice the sharpness.
  return new Blob([buildPdf(pages, { title: options.title, dpi: 96 }).slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  })
}

export interface ExportResult {
  readonly blob: Blob
  readonly extension: string
}

/** Encodes the capture in the kind the user chose. */
export async function exportAs(
  canvas: HTMLCanvasElement,
  kind: ExportKind,
  options: { readonly title?: string | undefined; readonly quality?: number | undefined } = {},
): Promise<ExportResult> {
  if (kind === 'pdf') {
    return { blob: await exportPdf(canvas, options), extension: '.pdf' }
  }
  const quality = kind === 'jpeg' ? (options.quality ?? DEFAULT_JPEG_QUALITY) : undefined
  return { blob: await encode(canvas, kind, quality), extension: extensionFor(kind) }
}
