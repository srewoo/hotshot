import { err, ok, type Result } from '../result'
import type { ProtocolError } from './protocol'

/**
 * The frozen backdrop and the scale factors that produced it (PRD FR-40).
 *
 * The zoom and DPR are sampled by the service worker at the instant of
 * capture and travel WITH the pixels. A content script reading
 * `window.devicePixelRatio` a frame later can disagree with the bitmap it is
 * cropping, and that disagreement is the wrong-crop bug.
 *
 * VALIDATED BY HAND, deliberately — this is the one documented exception to
 * "zod for all external input" (CLAUDE.md §2). This module is imported by the
 * content script, where zod costs ~54 KB of a 120 KB budget (PRD §6) to check
 * three fields. Everything outside the content script still uses zod; the
 * exception is bounded to this file and covered by `backdrop.test.ts`.
 */

export interface Backdrop {
  readonly dataUrl: string
  readonly zoom: number
  readonly dpr: number
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isPositiveFinite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

export function parseBackdropResponse(raw: unknown): Result<Backdrop, ProtocolError> {
  if (!isRecord(raw)) {
    return err({ issues: ['expected an object response, got ' + typeof raw] })
  }

  // A failure response carries the service worker's own reason; surface it
  // verbatim rather than replacing it with a generic message.
  if (raw['ok'] === false) {
    const reason = typeof raw['error'] === 'string' && raw['error'].length > 0 ? raw['error'] : null
    return err({ issues: [reason ?? 'the capture failed without a stated reason'] })
  }

  const issues: string[] = []
  if (raw['ok'] !== true) issues.push('ok: expected true')

  const dataUrl = raw['dataUrl']
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
    issues.push('dataUrl: expected a data:image/png URL')
  }

  // Absent factors are rejected rather than defaulted to 1: defaulting is how
  // the 150%-zoom bug survives a refactor, because the crop looks plausible
  // and is silently wrong.
  const zoom = raw['zoom']
  if (!isPositiveFinite(zoom)) issues.push('zoom: expected a positive finite number')

  const dpr = raw['dpr']
  if (!isPositiveFinite(dpr)) issues.push('dpr: expected a positive finite number')

  if (issues.length > 0) return err({ issues })

  return ok({ dataUrl: dataUrl as string, zoom: zoom as number, dpr: dpr as number })
}
