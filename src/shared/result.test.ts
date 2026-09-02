import { describe, expect, test } from 'vitest'
import { err, isErr, isOk, mapOk, ok, unwrapOr, type Result } from './result'

/**
 * Architecture §6: errors cross realm boundaries as values, never as thrown
 * exceptions. A structured clone strips an Error's prototype and stack, so a
 * thrown error degrades to "[object Object]" at precisely the moment the
 * detail is needed.
 */

describe('Result', () => {
  test('carries a success value', () => {
    const r = ok(42)
    expect(isOk(r)).toBe(true)
    expect(isErr(r)).toBe(false)
    expect(r.value).toBe(42)
  })

  test('carries a failure value', () => {
    const r = err({ kind: 'auth', status: 401 })
    expect(isErr(r)).toBe(true)
    expect(isOk(r)).toBe(false)
    expect(r.error).toEqual({ kind: 'auth', status: 401 })
  })

  test('survives a structured clone, which a thrown Error does not', () => {
    const r = err({ kind: 'auth', status: 401, message: 'token rejected' })
    const cloned = structuredClone(r) as typeof r
    expect(isErr(cloned)).toBe(true)
    expect(cloned.error.message).toBe('token rejected')
  })

  test('mapOk transforms a success and leaves the shape intact', () => {
    const r = mapOk(ok(2), (n) => n * 3)
    expect(isOk(r) && r.value).toBe(6)
  })

  test('mapOk does not run the transform on a failure', () => {
    let ran = false
    const r: Result<number, string> = err('nope')
    const out = mapOk(r, (n: number) => {
      ran = true
      return n * 3
    })
    expect(ran).toBe(false)
    expect(isErr(out) && out.error).toBe('nope')
  })

  test('unwrapOr returns the fallback only on failure', () => {
    expect(unwrapOr(ok('real'), 'fallback')).toBe('real')
    expect(unwrapOr(err('boom') as Result<string, string>, 'fallback')).toBe('fallback')
  })
})
