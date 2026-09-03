import { cropToBitmap } from './crop'
import { loadEditor } from '../editor-bridge'
import { toDeviceRect, type CssRect, type ScaleFactors } from '../../shared/geometry/device-rect'

/**
 * Handing a finished selection to the editor (PRD FR-1 → FR-7).
 *
 * The step where a capture stops being an overlay concern and becomes an
 * editing one. Kept apart from the controller because everything here is
 * failure handling: a crop that cannot be cut, or an editor chunk that will
 * not load, must leave the user with a reason rather than a dimmed page.
 */

export interface CommitDeps {
  readonly root: ShadowRoot
  readonly hint: HTMLDivElement
  readonly scale: ScaleFactors
  /** The bitmap the crop is cut from; null until phase 2 lands. */
  backdropUrl(): string | null
  /** False once this session has been replaced or torn down. */
  live(): boolean
  /** Strips the selection chrome, leaving the shadow root for the editor. */
  clearChrome(): void
  destroy(): void
}

/**
 * Crops the selection and opens the editor over it.
 *
 * Awaits phase 2 rather than assuming it has landed: the user can commit
 * inside 200 ms — with Enter, or a fast drag-and-release — and the crop needs
 * the bitmap that only the worker can produce.
 */
export async function commitSelection(
  rect: CssRect,
  ready: Promise<unknown>,
  deps: CommitDeps,
): Promise<void> {
  deps.hint.textContent = 'capturing…'
  await ready

  const backdropUrl = deps.backdropUrl()
  if (!backdropUrl || !deps.live()) {
    // Phase 2 has already reported the reason in the hint.
    return
  }

  const device = toDeviceRect(rect, deps.scale)
  const bitmap = await cropToBitmap(backdropUrl, device)

  let editor
  try {
    editor = await loadEditor()
  } catch (error: unknown) {
    // The crop exists but has nowhere to go. Say so instead of leaving a
    // dimmed page and a lost capture.
    bitmap.close()
    deps.hint.textContent = 'the editor could not load — press esc'
    console.error(`[Hotshot] ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  deps.clearChrome()
  await editor.openCapture(deps.root, bitmap, device, deps.destroy)
}
