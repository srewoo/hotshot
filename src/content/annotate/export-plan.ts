/**
 * Choosing an export encoding, and fitting one to a size limit.
 *
 * Two problems that share an answer. The user picks PNG, JPG or PDF; and every
 * destination has an attachment limit a DPR-2 full-page capture routinely
 * exceeds — Jira sites commonly cap at 10 MB (PRD §7.1), and the alternative
 * to compressing is a shipped capture that fails at the last step, after the
 * work of annotating it.
 *
 * The DECISION is pure and lives here; applying it needs a canvas and lives in
 * `export-image.ts`. That split is what lets the ladder be tested exhaustively
 * without a browser, including the cases that only happen on enormous pages.
 */

export type ImageFormat = 'png' | 'jpeg'

export interface EncodeStep {
  readonly format: ImageFormat
  /** JPEG quality, 0–1. Absent for PNG, which is lossless. */
  readonly quality?: number
  /** Linear scale applied to both axes before encoding. 1 = full size. */
  readonly scale: number
}

/** The MIME type Chrome's `toBlob` expects. */
export function mimeFor(format: ImageFormat): string {
  return format === 'png' ? 'image/png' : 'image/jpeg'
}

export function extensionFor(format: ImageFormat): string {
  return format === 'png' ? '.png' : '.jpg'
}

/**
 * The ladder tried, in order, to fit a capture inside a byte limit.
 *
 * Ordered by what it costs the user, cheapest first: keep every pixel and
 * every colour (PNG); then trade colour fidelity, which on a screenshot of
 * text is nearly invisible at 0.92; then trade resolution, which is the first
 * change a reader would actually notice. Resolution goes last on purpose — a
 * downscaled screenshot of a stack trace stops being readable, which defeats
 * the point of attaching it.
 */
export function compressionLadder(): readonly EncodeStep[] {
  return [
    { format: 'png', scale: 1 },
    { format: 'jpeg', quality: 0.92, scale: 1 },
    { format: 'jpeg', quality: 0.8, scale: 1 },
    { format: 'jpeg', quality: 0.7, scale: 1 },
    { format: 'jpeg', quality: 0.8, scale: 0.75 },
    { format: 'jpeg', quality: 0.75, scale: 0.6 },
    { format: 'jpeg', quality: 0.7, scale: 0.5 },
    { format: 'jpeg', quality: 0.6, scale: 0.35 },
  ]
}

export interface FitOutcome {
  readonly step: EncodeStep
  /**
   * What to tell the user, or null when nothing was given up.
   *
   * Never silent: a capture that was quietly downscaled to fit an attachment
   * limit is a capture the user may later be surprised they cannot read.
   */
  readonly note: string | null
}

/** Describes a step's cost in the terms a user cares about. */
export function describeStep(step: EncodeStep): string | null {
  if (step.format === 'png' && step.scale === 1) return null

  const parts: string[] = []
  if (step.format === 'jpeg') parts.push('converted to JPG')
  if (step.scale !== 1) parts.push(`scaled to ${Math.round(step.scale * 100)}%`)
  return parts.join(' and ')
}

/**
 * Picks the first ladder step whose encoded size fits.
 *
 * `measure` encodes at a step and reports the byte length. It is injected so
 * the search is testable, and because the only honest way to know a JPEG's
 * size is to encode it — estimating from dimensions is wrong by multiples on
 * the flat colour that screenshots are mostly made of.
 */
export async function fitWithinBytes(
  limitBytes: number,
  measure: (step: EncodeStep) => Promise<number>,
  ladder: readonly EncodeStep[] = compressionLadder(),
): Promise<FitOutcome | null> {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    throw new RangeError(`limitBytes must be a positive finite number, got ${limitBytes}`)
  }

  for (const step of ladder) {
    if ((await measure(step)) <= limitBytes) {
      return { step, note: describeStep(step) }
    }
  }
  // Nothing fit. The caller must say so rather than ship a truncated file.
  return null
}
