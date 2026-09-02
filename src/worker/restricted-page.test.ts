import { describe, expect, test } from 'vitest'
import { restrictionFor } from './restricted-page'

/**
 * PRD FR-30. Silent failure on a `chrome://` page is the number-one one-star
 * review theme in this category, so every refusal must carry a named reason
 * the UI can show verbatim.
 */

describe('restrictionFor', () => {
  test('permits an ordinary web page', () => {
    expect(restrictionFor('https://example.com/some/path')).toBeNull()
    expect(restrictionFor('http://localhost:3000/')).toBeNull()
  })

  test('permits a file URL, which the user may have granted access to', () => {
    // Chrome gates this behind a user-set toggle; refusing outright would be
    // wrong for the users who enabled it.
    expect(restrictionFor('file:///Users/someone/page.html')).toBeNull()
  })

  test.each([
    ['chrome://settings/', 'browser-page'],
    ['chrome://extensions', 'browser-page'],
    ['edge://settings/', 'browser-page'],
    ['about:blank', 'browser-page'],
    ['devtools://devtools/bundled/inspector.html', 'browser-page'],
    ['view-source:https://example.com', 'browser-page'],
  ])('refuses %s as a browser page', (url, kind) => {
    expect(restrictionFor(url)?.kind).toBe(kind)
  })

  test('refuses the Chrome Web Store, which extensions may not script', () => {
    expect(restrictionFor('https://chromewebstore.google.com/detail/x')?.kind).toBe('web-store')
    expect(restrictionFor('https://chrome.google.com/webstore/detail/x')?.kind).toBe('web-store')
  })

  test('refuses another extension page', () => {
    expect(restrictionFor('chrome-extension://abcdef/options.html')?.kind).toBe('extension-page')
  })

  test('refuses the built-in PDF viewer', () => {
    expect(restrictionFor('https://example.com/manual.pdf')?.kind).toBe('pdf')
  })

  test('does not mistake a pdf query parameter for a PDF document', () => {
    expect(restrictionFor('https://example.com/search?q=pdf')).toBeNull()
  })

  test('refuses an undefined URL rather than assuming it is capturable', () => {
    // `tab.url` is undefined when the extension lacks permission to read it.
    expect(restrictionFor(undefined)?.kind).toBe('unknown')
  })

  test('every reason carries user-facing copy that names the actual problem', () => {
    for (const url of ['chrome://settings/', 'chrome-extension://x/y.html', undefined]) {
      const r = restrictionFor(url)
      expect(r).not.toBeNull()
      expect(r?.message.length).toBeGreaterThan(20)
      // Never the generic non-explanation.
      expect(r?.message.toLowerCase()).not.toContain('something went wrong')
    }
  })

  test('the copy tells the user what to do next, not just what failed', () => {
    const r = restrictionFor('chrome://settings/')
    expect(r?.message).toMatch(/Chrome|browser/i)
  })
})

describe('localisation', () => {
  test('falls back to English when chrome.i18n is unavailable', () => {
    // Unit tests run without the extension runtime. A restriction that
    // rendered as an empty string here would be the silent failure FR-30
    // exists to prevent, so the fallback is load-bearing, not decorative.
    expect(globalThis.chrome).toBeUndefined()
    expect(restrictionFor('chrome://settings/')?.message.length).toBeGreaterThan(20)
  })

  test('prefers a localised string when the runtime provides one', () => {
    const original = globalThis.chrome
    // @ts-expect-error — minimal stub of the runtime surface under test.
    globalThis.chrome = { i18n: { getMessage: () => 'Localised copy for this page.' } }
    try {
      expect(restrictionFor('chrome://settings/')?.message).toBe('Localised copy for this page.')
    } finally {
      globalThis.chrome = original
    }
  })

  test('ignores an empty localised string rather than showing nothing', () => {
    const original = globalThis.chrome
    // A missing key returns "" from chrome.i18n — showing that would be worse
    // than showing untranslated English.
    // @ts-expect-error — minimal stub.
    globalThis.chrome = { i18n: { getMessage: () => '' } }
    try {
      expect(restrictionFor('chrome://settings/')?.message.length).toBeGreaterThan(20)
    } finally {
      globalThis.chrome = original
    }
  })
})
