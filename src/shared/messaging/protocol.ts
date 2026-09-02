import { z } from 'zod'
import { err, ok, type Result } from '../result'

/**
 * The realm boundary (Architecture §4.1).
 *
 * Messages arriving from another realm are untrusted input in the same sense
 * an HTTP body is — a stale content script left over from a previous extension
 * version can send a shape this one has never seen. Every envelope is
 * validated before any module acts on it, and no module calls
 * `chrome.runtime.sendMessage` directly.
 */

const tabId = z.number().int().positive()

export const captureModeSchema = z.enum(['region', 'fullpage', 'element', 'delayed'])
export type CaptureMode = z.infer<typeof captureModeSchema>

export const abortReasonSchema = z.enum([
  'user-cancelled',
  'scale-changed', // FR-40: zoom or DPR moved mid-capture
  'canvas-limit', // FR-43: page taller than this display can stitch
  'restricted-page', // FR-30
  'quota-exhausted', // FR-31
])
export type AbortReason = z.infer<typeof abortReasonSchema>

const captureBegin = z.object({
  kind: z.literal('capture/begin'),
  mode: captureModeSchema,
  tabId,
})

const captureProgress = z.object({
  kind: z.literal('capture/progress'),
  captured: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  etaMs: z.number().nonnegative(),
})

const captureAbort = z.object({
  kind: z.literal('capture/abort'),
  reason: abortReasonSchema,
  /** FR-31: Esc stops and KEEPS the partial stitch. A second Esc discards. */
  keepPartial: z.boolean(),
})

const captureComplete = z.object({
  kind: z.literal('capture/complete'),
  captureId: z.string().min(1),
  widthDevicePx: z.number().int().positive(),
  heightDevicePx: z.number().int().positive(),
})

/**
 * `discriminatedUnion` rather than `union`: it reports the failing member's
 * own issues instead of a wall of alternatives, which is what makes a
 * production message-shape bug diagnosable from a single log line.
 */
export const envelopeSchema = z
  .discriminatedUnion('kind', [captureBegin, captureProgress, captureAbort, captureComplete])
  // Cross-field rules live here rather than on a member: a `.refine()` on a
  // union member produces a ZodEffects, which has no discriminator for
  // `discriminatedUnion` to read.
  .superRefine((msg, ctx) => {
    // A determinate progress bar that can report 15/14 is not determinate.
    if (msg.kind === 'capture/progress' && msg.captured > msg.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'captured cannot exceed total',
        path: ['captured'],
      })
    }
  })

export type Envelope = z.infer<typeof envelopeSchema>

export interface ProtocolError {
  readonly issues: readonly string[]
}

export function parseEnvelope(raw: unknown): Result<Envelope, ProtocolError> {
  const parsed = envelopeSchema.safeParse(raw)
  if (parsed.success) return ok(parsed.data)

  return err({
    issues: parsed.error.issues.map((i) =>
      i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message,
    ),
  })
}
