import { openEditor } from './annotate/editor'
import { addPin } from './pin/pin-controller'
import { mountRecordBar } from './record/record-bar'
import { captureFilename, downloadBlob } from './download'
import type { EditorApi } from './editor-bridge'

/**
 * The editor chunk (PRD §6 budget, FR-1's fast path).
 *
 * Injected on demand by the overlay through `editor-bridge`, and registers
 * itself on the shared isolated-world global. Everything that is only needed
 * once pixels exist lives behind this entry point: the annotation editor, the
 * pin controller, the recorder, and saving to disk.
 */

const api: EditorApi = {
  async openCapture(root, bitmap, rect, onClose) {
    await openEditor(root, bitmap, rect, (result) => {
      if (result.action === 'download' && result.blob) {
        // The filename template ends in `.png`; an export swaps the suffix so
        // a PDF does not land in Downloads pretending to be an image.
        const name = result.extension
          ? captureFilename().replace(/\.png$/, result.extension)
          : undefined
        downloadBlob(result.blob, name)
      }
      if (result.action === 'pin' && result.blob) void addPin(result.blob)
      bitmap.close()
      onClose()
    })
  },

  addPin,
  mountRecordBar,
}

window.__hotshotEditor = api
