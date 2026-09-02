import { openEditor } from '../annotate/editor'
import { addPin } from '../pin/pin-controller'
import { downloadBlob } from './crop'
import type { DeviceRect } from '../../shared/geometry/device-rect'

/**
 * Hands a finished crop to the editor and routes its result.
 *
 * The editor mounts into the overlay's own shadow root, so the page's CSS
 * still cannot reach our UI after the selection chrome is gone.
 */
export async function handoffToEditor(
  root: ShadowRoot,
  bitmap: ImageBitmap,
  rect: DeviceRect,
  onClose: () => void,
): Promise<void> {
  await openEditor(root, bitmap, rect, (result) => {
    if (result.action === 'download' && result.blob) downloadBlob(result.blob)
    if (result.action === 'pin' && result.blob) void addPin(result.blob)
    bitmap.close()
    onClose()
  })
}
