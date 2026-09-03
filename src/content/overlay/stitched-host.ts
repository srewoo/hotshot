import { HOTSHOT_HOST_ATTRIBUTE } from './element-chain'
import { loadEditor } from '../editor-bridge'

/**
 * Mounts the editor over an already-captured image (PRD FR-2 → FR-7).
 *
 * Full-page capture has no selection phase — the whole document IS the
 * selection — so it needs the editor without the overlay's picking chrome.
 * Before this existed the stitch went straight to a download, which meant the
 * one mode that most needs annotation (a long page, where the reader needs to
 * be told where to look) was the one mode that could not be annotated, and it
 * never reached history because history is written by the editor's own commit.
 */

interface StitchedSession {
  destroy(): void
}

let active: StitchedSession | null = null

export async function mountStitchedEditor(dataUrl: string): Promise<void> {
  // A second full-page capture replaces the first rather than stacking two
  // editors, matching `mountOverlay`'s rule.
  active?.destroy()

  const response = await fetch(dataUrl)
  const bitmap = await createImageBitmap(await response.blob())

  const host = document.createElement('div')
  // Lets the element picker recognise and refuse our own UI.
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
  })
  const root = host.attachShadow({ mode: 'closed' })

  // FR-29: the page gets its focus back, whatever the editor does with it.
  const restoreFocus = document.activeElement as HTMLElement | null

  function destroy(): void {
    host.remove()
    active = null
    restoreFocus?.focus?.()
  }

  document.documentElement.append(host)
  active = { destroy }

  try {
    const editor = await loadEditor()
    await editor.openCapture(
      root,
      bitmap,
      // The stitch IS the crop, so the rect is the whole bitmap. The editor
      // scales it to fit the viewport for display; the canvas stays at full
      // device resolution, so annotations land on real pixels (FR-6).
      { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      destroy,
    )
  } catch (error: unknown) {
    // Tearing the host down here matters: a half-mounted editor is an opaque
    // full-viewport div the user cannot dismiss.
    destroy()
    bitmap.close()
    throw error
  }
}
