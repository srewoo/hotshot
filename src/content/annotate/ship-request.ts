import type { ProviderId } from '../../storage/token-repo'
import { blobToDataUrl } from './editor-commit'

/**
 * Asks the service worker to ship a capture (PRD FR-13..FR-19).
 *
 * The worker owns tokens and network access; the content script never holds a
 * credential and never talks to a service directly.
 *
 * The image crosses as a DATA URL, not an ArrayBuffer.
 * `chrome.runtime.sendMessage` serialises through JSON rather than the
 * structured clone algorithm, so a buffer arrives as `{}` and
 * `new Blob([{}])` produces the eleven bytes of the string "[object Object]".
 * Every capture ever shipped to a destination was that string until this was
 * found — the upload succeeded and the attachment was not an image.
 */
export async function shipToDestination(
  provider: ProviderId,
  key: string,
  blob: Blob,
): Promise<{ ok: boolean; message: string }> {
  const response = (await chrome.runtime.sendMessage({
    kind: 'destinations/ship',
    provider,
    key,
    dataUrl: await blobToDataUrl(blob),
    url: location.href,
    title: document.title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  })) as
    | {
        ok?: boolean
        message?: string
        destination?: { provider: string; key: string; url?: string }
      }
    | undefined

  // Recorded against the capture in history, which is what lets the library
  // offer "send it there again" without re-taking the screenshot (FR-25).
  if (response?.ok === true && response.destination) {
    void chrome.runtime.sendMessage({
      kind: 'history/destination',
      destination: response.destination,
    })
  }

  return {
    ok: response?.ok === true,
    // A missing response means the worker was terminated mid-send, which is
    // worth saying rather than showing a blank failure.
    message: response?.message ?? 'Hotshot lost contact with the extension. Try again.',
  }
}
