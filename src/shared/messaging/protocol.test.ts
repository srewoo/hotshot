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

  test('the error names the offending field so a bug is diagnosable', () => {
    const r = parseEnvelope({ kind: 'capture/begin', mode: 'region', tabId: 'seven' })
    expect(isErr(r) && r.error.issues.join(' ')).toMatch(/tabId/)
  })
})
