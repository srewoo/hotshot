import { err, ok, type Result } from '../shared/result'

/**
 * Clipboard image write (PRD FR-42, review finding B5).
 *
 * Runs in the CONTENT SCRIPT, inside the user's gesture, because
 * `navigator.clipboard` requires a focused document and an offscreen document
 * can never take focus — `Reason.CLIPBOARD` notwithstanding, that path only
 * works for text via legacy `execCommand`.
 *
 * The write is awaited before the caller tears the overlay down: FR-20's
 * fire-and-forget rule is explicitly carved out here, because a clipboard
 * write racing its own teardown fails silently and the user simply pastes
 * nothing.
 */

export type ClipboardFailureReason = 'not-focused' | 'write-failed' | 'unsupported-type' | 'empty'

export interface ClipboardFailure {
  readonly reason: ClipboardFailureReason
  /** Safe to show the user; never contains page or token content. */
  readonly detail: string
}

/** The clipboard surface, injected so the focus rule can be tested. */
export interface ClipboardTarget {
  hasFocus(): boolean
  write(items: ClipboardItem[]): Promise<void>
}

export function browserClipboard(): ClipboardTarget {
  return {
    hasFocus: () => document.hasFocus(),
    write: (items) => navigator.clipboard.write(items),
  }
}

export async function writeImageToClipboard(
  blob: Blob,
  target: ClipboardTarget,
): Promise<Result<true, ClipboardFailure>> {
  if (blob.size === 0) {
    return err({ reason: 'empty', detail: 'The capture produced no image data.' })
  }

  // Chrome's async clipboard accepts image/png only. Writing anything else
  // succeeds and then pastes as nothing, which is worse than refusing.
  if (blob.type !== 'image/png') {
    return err({
      reason: 'unsupported-type',
      detail: `The clipboard accepts PNG only; this capture is ${blob.type || 'untyped'}.`,
    })
  }

  if (!target.hasFocus()) {
    return err({
      reason: 'not-focused',
      detail: 'The page lost focus before the copy completed. The image was saved instead.',
    })
  }

  try {
    await target.write([new ClipboardItem({ 'image/png': blob })])
    return ok(true)
  } catch (error) {
    return err({
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
