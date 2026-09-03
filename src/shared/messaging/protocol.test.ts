import { describe, expect, test } from 'vitest'
import { parseEnvelope, type Envelope } from './protocol'
import { isErr, isOk } from '../result'

/**
 * Architecture §4.1. Every cross-realm message is validated at the boundary.
 * The reviewer found four keybinding collisions and a wrong-crop bug by reading
 * carefully; a typed, validated boundary catches that class of defect
 * mechanically instead.
 *
 * Messages arrive as structured clones from another realm. They are untrusted
 * input in the same sense an HTTP body is (CLAUDE.md §2: zod for all external
 * input), because a compromised or merely out-of-date realm can send anything.
 */

describe('parseEnvelope', () => {
  test('accepts a well-formed capture/begin', () => {
    const msg: Envelope = { kind: 'capture/begin', mode: 'region', tabId: 7 }
    const r = parseEnvelope(msg)
    expect(isOk(r)).toBe(true)
    expect(isOk(r) && r.value).toEqual(msg)
  })

  test('accepts every capture mode the PRD defines', () => {
    for (const mode of ['region', 'fullpage', 'element', 'delayed'] as const) {
      const r = parseEnvelope({ kind: 'capture/begin', mode, tabId: 1 })
      expect(isOk(r), `mode ${mode} should be valid`).toBe(true)
    }
  })

  test('rejects an unknown capture mode rather than defaulting to region', () => {
    // Silently defaulting is how a version skew becomes a wrong capture.
    const r = parseEnvelope({ kind: 'capture/begin', mode: 'panorama', tabId: 1 })
    expect(isErr(r)).toBe(true)
  })

  test('rejects an unknown message kind', () => {
    const r = parseEnvelope({ kind: 'capture/teleport', tabId: 1 })
    expect(isErr(r)).toBe(true)
  })

  test('rejects a message that is not an object at all', () => {
    for (const junk of [null, undefined, 'capture/begin', 42, []]) {
      expect(isErr(parseEnvelope(junk)), `${String(junk)} should be rejected`).toBe(true)
    }
  })

  test('rejects a tabId that is not a positive integer', () => {
    expect(isErr(parseEnvelope({ kind: 'capture/begin', mode: 'region', tabId: -1 }))).toBe(true)
    expect(isErr(parseEnvelope({ kind: 'capture/begin', mode: 'region', tabId: 1.5 }))).toBe(true)
  })

  test('accepts capture/progress and preserves the tile counts', () => {
    const r = parseEnvelope({
      kind: 'capture/progress',
      captured: 7,
      total: 14,
      etaMs: 3500,
    })
    expect(isOk(r) && r.value).toEqual({
      kind: 'capture/progress',
      captured: 7,
      total: 14,
      etaMs: 3500,
    })
  })

  test('rejects progress claiming more tiles captured than exist', () => {
    // A determinate progress bar that can report 15/14 is not determinate.
    const r = parseEnvelope({ kind: 'capture/progress', captured: 15, total: 14, etaMs: 0 })
    expect(isErr(r)).toBe(true)
  })

  test('accepts capture/abort with a known reason', () => {
    const r = parseEnvelope({ kind: 'capture/abort', reason: 'scale-changed', keepPartial: true })
    expect(isOk(r)).toBe(true)
  })

  test('rejects an abort with an unknown reason', () => {
    const r = parseEnvelope({ kind: 'capture/abort', reason: 'vibes', keepPartial: true })
    expect(isErr(r)).toBe(true)
  })

  test('strips unknown properties instead of forwarding them', () => {
    const r = parseEnvelope({
      kind: 'capture/begin',
      mode: 'region',
      tabId: 3,
      injected: 'payload',
    })
    expect(isOk(r) && Object.hasOwn(r.value, 'injected')).toBe(false)
  })

  describe('capture/stitched', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

    test('accepts a PNG data URL with no partial warning', () => {
      const r = parseEnvelope({ kind: 'capture/stitched', dataUrl: png, partialWarning: null })
      expect(isOk(r) && r.value.kind).toBe('capture/stitched')
    })

    test('accepts a partial stitch and carries its reason', () => {
      const r = parseEnvelope({
        kind: 'capture/stitched',
        dataUrl: png,
        partialWarning: 'stopped after 4 of 11 tiles',
      })
      expect(isOk(r) && r.value.kind === 'capture/stitched' && r.value.partialWarning).toBe(
        'stopped after 4 of 11 tiles',
      )
    })

    /**
     * The content script fetches this value in the PAGE's origin. A sender
     * that could substitute an http(s) or blob URL would turn the handoff into
     * a page-origin request — the one thing the no-backend promise forbids.
     */
    test.each([
      'https://exfiltrate.example/pixel.png',
      'http://127.0.0.1:9000/x.png',
      'blob:https://example.com/8a7f',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'javascript:alert(1)',
      '',
    ])('rejects a dataUrl that is not a PNG data URL: %s', (dataUrl) => {
      expect(isErr(parseEnvelope({ kind: 'capture/stitched', dataUrl, partialWarning: null }))).toBe(
        true,
      )
    })

    test('rejects a PNG data URL whose payload is not base64', () => {
      const r = parseEnvelope({
        kind: 'capture/stitched',
        dataUrl: 'data:image/png;base64,not base64!',
        partialWarning: null,
      })
      expect(isErr(r)).toBe(true)
    })

    test('rejects an empty partial warning, which would render as a blank reason', () => {
      const r = parseEnvelope({ kind: 'capture/stitched', dataUrl: png, partialWarning: '' })
      expect(isErr(r)).toBe(true)
    })

    test('requires the partialWarning field rather than defaulting it', () => {
      expect(isErr(parseEnvelope({ kind: 'capture/stitched', dataUrl: png }))).toBe(true)
    })

    test('the error names the offending field', () => {
      const r = parseEnvelope({ kind: 'capture/stitched', dataUrl: 'nope', partialWarning: null })
      expect(isErr(r) && r.error.issues.join(' ')).toMatch(/dataUrl/)
    })
  })

  describe('capture/element-band (FR-5)', () => {
    const band = { kind: 'capture/element-band', top: 5_000, left: 120, width: 640, height: 2_400 }

    test('accepts an element box', () => {
      const r = parseEnvelope(band)
      expect(isOk(r) && r.value.kind).toBe('capture/element-band')
    })

    test('accepts a band starting at the very top of the document', () => {
      expect(isOk(parseEnvelope({ ...band, top: 0 }))).toBe(true)
    })

    /**
     * `top` is a DOCUMENT offset, so it cannot be negative — a negative one
     * would mean scrolling above the page, and the stitch would silently start
     * in the wrong place rather than fail.
     */
    test('rejects a negative document offset', () => {
      expect(isErr(parseEnvelope({ ...band, top: -1 }))).toBe(true)
    })

    test('allows a negative left, for an element that starts off-screen', () => {
      expect(isOk(parseEnvelope({ ...band, left: -40 }))).toBe(true)
    })

    test.each(['width', 'height'])('rejects a zero or negative %s', (field) => {
      expect(isErr(parseEnvelope({ ...band, [field]: 0 }))).toBe(true)
      expect(isErr(parseEnvelope({ ...band, [field]: -10 }))).toBe(true)
    })

    test('rejects a non-numeric measurement rather than coercing it', () => {
      expect(isErr(parseEnvelope({ ...band, height: '2400' }))).toBe(true)
    })

    test('the error names the offending field', () => {
      const r = parseEnvelope({ ...band, width: 0 })
      expect(isErr(r) && r.error.issues.join(' ')).toMatch(/width/)
    })
  })

  test('the error names the offending field so a bug is diagnosable', () => {
    const r = parseEnvelope({ kind: 'capture/begin', mode: 'region', tabId: 'seven' })
    expect(isErr(r) && r.error.issues.join(' ')).toMatch(/tabId/)
  })
})
