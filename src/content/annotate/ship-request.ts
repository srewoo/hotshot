import type { ProviderId } from '../../storage/token-repo'

/**
 * Asks the service worker to ship a capture (PRD FR-13..FR-19).
 *
 * The worker owns tokens and network access; the content script never holds a
 * credential and never talks to a service directly.
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
    blob: await blob.arrayBuffer(),
    url: location.href,
    title: document.title,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  })) as { ok?: boolean; message?: string } | undefined

  return {
    ok: response?.ok === true,
    // A missing response means the worker was terminated mid-send, which is
    // worth saying rather than showing a blank failure.
    message: response?.message ?? 'Hotshot lost contact with the extension. Try again.',
  }
}
