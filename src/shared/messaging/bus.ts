import { isErr } from '../result'
import { envelopeSchema, parseEnvelope, type Envelope, type ProtocolError } from './protocol'

/**
 * The only module permitted to touch a message transport (Architecture §4.1).
 *
 * Validation happens here on both edges — outbound as well as inbound — so a
 * bad shape fails at the sender, where the stack trace still means something,
 * rather than in another realm where it arrives as an unexplained no-op.
 */

/** The subset of `chrome.runtime` the bus needs. Injected for testability. */
export interface Transport {
  send(msg: unknown): void
  onMessage(cb: (raw: unknown) => void): () => void
}

export interface BusOptions {
  /**
   * Called when a message fails validation. Never optional in practice: a
   * dropped message nobody reports is the hardest class of extension bug to
   * diagnose (CLAUDE.md — fail loudly, never swallow errors).
   */
  onInvalid?: (error: ProtocolError, raw: unknown) => void
}

export type Handler<K extends Envelope['kind']> = (msg: Extract<Envelope, { kind: K }>) => void

export interface Bus {
  send(msg: Envelope): void
  on<K extends Envelope['kind']>(kind: K, handler: Handler<K>): () => void
}

export function createBus(transport: Transport, options: BusOptions = {}): Bus {
  // Stored as the widened handler type: the public `on` signature keeps call
  // sites narrowed, while the registry itself cannot be expressed per-key.
  type AnyHandler = (msg: Envelope) => void
  const handlers = new Map<Envelope['kind'], Set<AnyHandler>>()

  transport.onMessage((raw) => {
    const parsed = parseEnvelope(raw)
    if (isErr(parsed)) {
      options.onInvalid?.(parsed.error, raw)
      return
    }
    const msg = parsed.value
    for (const handler of handlers.get(msg.kind) ?? []) {
      handler(msg)
    }
  })

  return {
    send(msg) {
      const parsed = envelopeSchema.safeParse(msg)
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
          .join('; ')
        throw new TypeError(`Refusing to send a malformed envelope — ${detail}`)
      }
      transport.send(parsed.data)
    },

    on(kind, handler) {
      let set = handlers.get(kind)
      if (!set) {
        set = new Set()
        handlers.set(kind, set)
      }
      const entry = handler as AnyHandler
      set.add(entry)
      return () => {
        set.delete(entry)
      }
    },
  }
}
