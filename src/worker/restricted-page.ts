/**
 * Pages Chrome will not let an extension script (PRD FR-30).
 *
 * Every refusal names the real reason. Silent failure on a `chrome://` page is
 * the number-one one-star review theme in this category, and "Something went
 * wrong" is the same failure wearing a nicer hat.
 */

export type RestrictionKind = 'browser-page' | 'web-store' | 'extension-page' | 'pdf' | 'unknown'

export interface Restriction {
  readonly kind: RestrictionKind
  /** Shown to the user verbatim. Error copy is design (DESIGN §6). */
  readonly message: string
}

const BROWSER_SCHEMES = ['chrome:', 'edge:', 'brave:', 'about:', 'devtools:', 'view-source:']

const MESSAGES: Record<RestrictionKind, string> = {
  'browser-page':
    'Chrome does not allow extensions to run on its own pages, so Hotshot cannot capture this one. Switch to a normal web page and try again.',
  'web-store':
    'Chrome blocks all extensions on the Web Store, so Hotshot cannot capture this page. Your browser’s built-in screenshot shortcut still works here.',
  'extension-page':
    'This is another extension’s page, and Chrome keeps extensions out of each other’s pages. Hotshot cannot capture it.',
  pdf: 'This is Chrome’s built-in PDF viewer, which extensions cannot read. Download the PDF and open it in a PDF app to capture from it.',
  unknown:
    'Hotshot cannot read this tab’s address, so it cannot tell whether capturing here is allowed. Reload the page and try again.',
}

const restriction = (kind: RestrictionKind): Restriction => ({ kind, message: MESSAGES[kind] })

export function restrictionFor(url: string | undefined): Restriction | null {
  // `tab.url` is undefined when the extension has no permission to read it.
  // Assuming that means "capturable" is how a silent no-op ships.
  if (!url) return restriction('unknown')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return restriction('unknown')
  }

  if (parsed.protocol === 'chrome-extension:') return restriction('extension-page')
  if (BROWSER_SCHEMES.includes(parsed.protocol)) return restriction('browser-page')

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    const host = parsed.hostname
    const isWebStore =
      host === 'chromewebstore.google.com' ||
      (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
    if (isWebStore) return restriction('web-store')
  }

  // Match the path only — `?q=pdf` is a search, not a document.
  if (/\.pdf$/i.test(parsed.pathname)) return restriction('pdf')

  return null
}
