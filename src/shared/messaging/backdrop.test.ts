import { describe, expect, test } from 'vitest'
import { parseBackdropResponse } from './backdrop'
import { isErr, isOk } from '../result'

/**
 * The backdrop response carries the scale factors alongside the pixels
 * (PRD FR-40).
 *
 * They must be sampled by the service worker at the same instant it captures,
 * not read separately by the content script: `window.devicePixelRatio` read a
 * frame later can disagree with the bitmap that was actually produced, and
 * that disagreement is precisely the wrong-crop bug.
 */

const valid = {
  ok: true as const,
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  zoom: 1.5,
  dpr: 2,
}

describe('parseBackdropResponse', () => {
  test('accepts a well-formed success response', () => {
    const r = parseBackdropResponse(valid)
    expect(isOk(r)).toBe(true)
    expect(isOk(r) && r.value.zoom).toBe(1.5)
    expect(isOk(r) && r.value.dpr).toBe(2)
  })

  test('accepts a failure response carrying the reason', () => {
    const r = parseBackdropResponse({ ok: false, error: 'quota exceeded' })
    expect(isErr(r)).toBe(true)
    expect(isErr(r) && r.error.issues.join(' ')).toMatch(/quota exceeded/)
  })

  test('rejects a success response with no zoom, rather than defaulting to 1', () => {
    // Defaulting is how the 150%-zoom bug survives a refactor: the crop looks
    // plausible and is silently wrong.
    const { zoom: _zoom, ...withoutZoom } = valid
    expect(isErr(parseBackdropResponse(withoutZoom))).toBe(true)
  })

  test('rejects a success response with no dpr', () => {
    const { dpr: _dpr, ...withoutDpr } = valid
    expect(isErr(parseBackdropResponse(withoutDpr))).toBe(true)
  })

  test('rejects a non-positive zoom or dpr', () => {
    expect(isErr(parseBackdropResponse({ ...valid, zoom: 0 }))).toBe(true)
    expect(isErr(parseBackdropResponse({ ...valid, dpr: -1 }))).toBe(true)
  })

  test('rejects a data URL that is not a PNG', () => {
    expect(isErr(parseBackdropResponse({ ...valid, dataUrl: 'https://example.com/x.png' }))).toBe(
      true,
    )
    expect(isErr(parseBackdropResponse({ ...valid, dataUrl: '' }))).toBe(true)
  })

  test('rejects an undefined response, which is what a dead service worker returns', () => {
    expect(isErr(parseBackdropResponse(undefined))).toBe(true)
  })

  test('names the offending field so a failure is diagnosable', () => {
    const r = parseBackdropResponse({ ...valid, zoom: 'lots' })
    expect(isErr(r) && r.error.issues.join(' ')).toMatch(/zoom/)
  })
})
