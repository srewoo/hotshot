import { browserClipboard, writeImageToClipboard } from '../clipboard'
import { isErr } from '../../shared/result'
import { exportAs, type ExportKind } from './export-image'

/**
 * Turning the edited canvas into a delivered artefact (FR-20, FR-32, FR-42).
 *
 * Split out of the editor so the editor is about editing. The ordering rule
 * here is load-bearing: history is written BEFORE any destination runs, so a
 * failed ship never loses the capture.
 */

export interface EditorResult {
  readonly action: 'copy' | 'download' | 'pin' | 'shipped' | 'cancel'
  readonly blob?: Blob | undefined
  /** Set when the download is not a PNG, so the file is named correctly. */
  readonly extension?: string | undefined
}

export interface HistoryRecord {
  readonly kind: 'history/record'
  /**
   * The capture as a PNG data URL — NOT an ArrayBuffer.
   *
   * `chrome.runtime.sendMessage` serialises through JSON, not the structured
   * clone algorithm, so an ArrayBuffer arrives as `{}` and
   * `new Blob([{}])` writes the eleven bytes of the string
   * "[object Object]". Every capture in history was that string until this was
   * found: the library listed rows whose images could not be decoded.
   *
   * Base64 costs a third more bytes over the channel. That is the price of the
   * worker owning storage, which is what keeps a content script on an
   * arbitrary page from reading a user's capture history.
   */
  readonly dataUrl: string
  readonly widthDevicePx: number
  readonly heightDevicePx: number
  readonly sourceUrl: string
  readonly title: string
}

/** The history payload, as a pure function of the capture and its page. */
export function historyRecord(
  dataUrl: string,
  size: { readonly width: number; readonly height: number },
  page: { readonly url: string; readonly title: string },
): HistoryRecord {
  return {
    kind: 'history/record',
    dataUrl,
    widthDevicePx: size.width,
    heightDevicePx: size.height,
    sourceUrl: page.url,
    title: page.title,
  }
}

/** Reads a blob as a data URL, which is what survives the message channel. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the capture for history.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * A backstop for the encode.
 *
 * Generous, because it is a guard against a hang rather than a UX deadline: a
 * 100-megapixel stitch legitimately takes seconds to encode.
 */
export const ENCODE_TIMEOUT_MS = 20_000

/**
 * Encodes the canvas, and refuses to hang.
 *
 * `toBlob` hands its result to a callback that Chromium is not obliged to
 * invoke, and was observed never firing when the export was preceded by DOM
 * writes in the same task. A pending promise there is the worst possible
 * failure: the user presses Enter, nothing happens, no error, forever. The
 * timeout converts that into a loud one (CLAUDE.md §1, "fail loudly").
 *
 * Callers should still avoid touching the DOM immediately before exporting —
 * see `editor.finish`.
 */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  timeoutMs: number = ENCODE_TIMEOUT_MS,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Encoding the capture did not complete within ${timeoutMs} ms; nothing was delivered.`,
          ),
        ),
      timeoutMs,
    )

    const done = <T>(settle: (value: T) => void) => (value: T) => {
      clearTimeout(timer)
      settle(value)
    }

    try {
      canvas.toBlob(
        (blob) =>
          blob
            ? done(resolve)(blob)
            : done(reject)(new Error('Could not encode the capture.')),
        'image/png',
      )
    } catch (error: unknown) {
      // A tainted canvas throws synchronously rather than calling back.
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Commits the capture to a local destination.
 *
 * The clipboard write is awaited before the caller tears the overlay down —
 * FR-20's fire-and-forget rule is explicitly carved out for it, because a
 * clipboard write racing its own teardown fails silently and the user pastes
 * nothing (review finding B5). A clipboard failure falls back to a download
 * rather than dropping the capture on the floor.
 */
export async function commitCapture(
  canvas: HTMLCanvasElement,
  action: 'copy' | 'download' | 'pin',
  /**
   * What a download produces (FR-39). Copy and pin ignore it: the clipboard
   * reliably carries only PNG (review finding B5), and a pin is a live image
   * on the page rather than a file.
   */
  exportKind: ExportKind = 'png',
): Promise<EditorResult> {
  const useChosenKind = action === 'download' && exportKind !== 'png'
  const exported = useChosenKind
    ? await exportAs(canvas, exportKind, { title: document.title })
    : null
  const blob = exported ? exported.blob : await canvasToBlob(canvas)

  // History always stores the PNG, whatever the download produced: it is the
  // archive copy, and re-opening a JPEG to edit would compound its losses.
  const archive = exported ? await canvasToBlob(canvas) : blob

  // Recorded first, and deliberately not awaited: the worker owns storage and
  // filters Incognito, and a slow IndexedDB write must not delay the paste.
  void chrome.runtime.sendMessage(
    historyRecord(
      await blobToDataUrl(archive),
      { width: canvas.width, height: canvas.height },
      { url: location.href, title: document.title },
    ),
  )

  if (action === 'copy') {
    const written = await writeImageToClipboard(blob, browserClipboard())
    if (isErr(written)) {
      console.warn(`[Hotshot] ${written.error.detail}`)
      return { action: 'download', blob }
    }
  }

  return exported ? { action, blob, extension: exported.extension } : { action, blob }
}
