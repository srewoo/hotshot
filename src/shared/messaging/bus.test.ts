import { describe, expect, test, vi } from 'vitest'
import { createBus, type Transport } from './bus'
import type { Envelope } from './protocol'

/**
 * Architecture §4.1: no module calls `chrome.runtime.sendMessage` directly.
 * The bus is the only place that touches the transport, so validation cannot
 * be forgotten at a call site.
 */

function transport(): Transport & { sent: unknown[]; deliver: (raw: unknown) => void } {
  const sent: unknown[] = []
  let handler: ((raw: unknown) => void) | null = null
  return {
    sent,
    send(msg) {
      sent.push(msg)
    },
    onMessage(cb) {
      handler = cb
      return () => {
        handler = null
      }
    },
    deliver(raw) {
      handler?.(raw)
    },
  }
}

const begin: Envelope = { kind: 'capture/begin', mode: 'region', tabId: 4 }

describe('bus.send', () => {
  test('forwards a valid envelope to the transport', () => {
    const t = transport()
    createBus(t).send(begin)
    expect(t.sent).toEqual([begin])
  })

  test('refuses to send an invalid envelope, failing at the sender', () => {
    const t = transport()
    const bus = createBus(t)
    // Cast models a stale caller or a bad refactor — the failure must happen
    // here, not silently in another realm where it is far harder to trace.
    expect(() => bus.send({ kind: 'capture/begin', mode: 'nope', tabId: 4 } as never)).toThrow(
      /mode/,
    )
    expect(t.sent).toEqual([])
  })
})

describe('bus.on', () => {
  test('delivers a valid envelope to a handler for its kind', () => {
    const t = transport()
    const seen: Envelope[] = []
    createBus(t).on('capture/begin', (m) => seen.push(m))

    t.deliver(begin)

    expect(seen).toEqual([begin])
  })

  test('narrows the handler argument to the matching member', () => {
    const t = transport()
    let captured = -1
    createBus(t).on('capture/progress', (m) => {
      // Compiles only if `m` is narrowed to the progress member.
      captured = m.captured
    })

    t.deliver({ kind: 'capture/progress', captured: 7, total: 14, etaMs: 100 })

    expect(captured).toBe(7)
  })

  test('does not invoke a handler registered for a different kind', () => {
    const t = transport()
    const other = vi.fn()
    createBus(t).on('capture/abort', other)

    t.deliver(begin)

    expect(other).not.toHaveBeenCalled()
  })

  test('drops a malformed message without invoking any handler', () => {
    const t = transport()
    const handler = vi.fn()
    createBus(t).on('capture/begin', handler)

    t.deliver({ kind: 'capture/begin', mode: 'panorama', tabId: 4 })

    expect(handler).not.toHaveBeenCalled()
  })

  test('reports a malformed message rather than swallowing it', () => {
    // CLAUDE.md: fail loudly, never swallow errors. A dropped message that
    // nobody reports is the hardest class of extension bug to diagnose.
    const t = transport()
    const onInvalid = vi.fn()
    createBus(t, { onInvalid }).on('capture/begin', vi.fn())

    t.deliver({ kind: 'capture/begin', mode: 'panorama', tabId: 4 })

    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(onInvalid.mock.calls[0]?.[0].issues.join(' ')).toMatch(/mode/)
  })

  test('one malformed message does not stop later valid ones', () => {
    const t = transport()
    const seen: Envelope[] = []
    createBus(t, { onInvalid: vi.fn() }).on('capture/begin', (m) => seen.push(m))

    t.deliver({ kind: 'nonsense' })
    t.deliver(begin)

    expect(seen).toEqual([begin])
  })

  test('unsubscribing stops delivery', () => {
    const t = transport()
    const handler = vi.fn()
    const off = createBus(t).on('capture/begin', handler)

    off()
    t.deliver(begin)

    expect(handler).not.toHaveBeenCalled()
  })

  test('supports several handlers for the same kind', () => {
    const t = transport()
    const a = vi.fn()
    const b = vi.fn()
    const bus = createBus(t)
    bus.on('capture/begin', a)
    bus.on('capture/begin', b)

    t.deliver(begin)

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
