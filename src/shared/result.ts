/**
 * A result carried as a value, not thrown.
 *
 * Architecture §6: a structured clone (which is how every cross-realm message
 * travels in MV3) strips an Error's prototype and stack. Throwing across a
 * realm boundary therefore loses exactly the detail you need. Results are
 * plain data and survive the trip intact.
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok
}

export function mapOk<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback
}
