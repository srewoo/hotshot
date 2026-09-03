import { renderFilename, DEFAULT_FILENAME_TEMPLATE } from '../storage/filename'

/**
 * Saving a capture to disk (PRD FR-39).
 *
 * Lives in the EDITOR chunk, not the overlay: the filename template pulls in
 * `Intl.Segmenter`-based sanitising that nothing on the capture fast path
 * needs, and the fast path is injected into every page.
 *
 * The download starts from the page because a download must begin in a
 * document — the same focus rule that governs the clipboard (FR-42).
 */

const pad = (n: number): string => String(n).padStart(2, '0')

export function captureFilename(now: Date = new Date()): string {
  return renderFilename(DEFAULT_FILENAME_TEMPLATE, {
    title: document.title,
    host: location.hostname,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    sequence: 1,
  })
}

export function downloadBlob(blob: Blob, filename = captureFilename()): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoked on the next task so the download has already taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
