import { chromeLocalArea, createTokenRepo, type ProviderId } from '../storage/token-repo'
import { createSettingsRepo } from '../storage/settings-repo'
import { resolveProvider } from '../integrations/registry'
import { shipCapture } from '../integrations/ship'
import { isErr } from '../shared/result'
import type { TargetCandidate, TargetRef } from '../integrations/provider'
import { createTargetCache } from './target-cache'

/**
 * Destination routing (PRD FR-13..FR-19).
 *
 * Lives in the worker because it owns tokens and network access — a content
 * script never holds a credential and never talks to a service directly. That
 * is what keeps a compromised page from reaching a user's Jira account.
 */

const PROVIDERS: readonly ProviderId[] = [
  'jira',
  'clickup',
  'notion',
  'slack',
  'linear',
  'trello',
  'asana',
  'dropbox',
]
const LAST_TARGET_PREFIX = 'hotshot.lastTarget.'

const area = chromeLocalArea()
const tokens = createTokenRepo(area)
const settings = createSettingsRepo(area)
const targetCache = createTargetCache(area)

const accounts = {
  async jira() {
    const stored = await area.get(['hotshot.account.jira'])
    const value = stored['hotshot.account.jira'] as { site?: string; email?: string } | undefined
    return value?.site && value.email ? { site: value.site, email: value.email } : null
  },
}

async function lastTarget(id: ProviderId): Promise<TargetRef | null> {
  const key = `${LAST_TARGET_PREFIX}${id}`
  const stored = await area.get([key])
  const value = stored[key]
  return typeof value === 'string' && value.length > 0 ? { key: value } : null
}

async function rememberTarget(id: ProviderId, target: TargetRef): Promise<void> {
  await area.set({ [`${LAST_TARGET_PREFIX}${id}`]: target.key })
}

/** Which services have a usable token, plus what each last shipped to. */
export async function listDestinations(): Promise<{
  configured: ProviderId[]
  remembered: Partial<Record<ProviderId, string>>
}> {
  const configured: ProviderId[] = []
  const remembered: Partial<Record<ProviderId, string>> = {}

  for (const id of PROVIDERS) {
    if (!(await tokens.get(id))) continue
    configured.push(id)
    const target = await lastTarget(id)
    if (target) remembered[id] = target.key
  }
  return { configured, remembered }
}

/**
 * Searches a service for plausible targets (FR-41).
 *
 * Runs in the worker for the same reason shipping does: the token never leaves
 * it. The empty-query list is cached briefly, because the picker opens on
 * every capture and that list is the same for a minute at a time.
 */
export async function handleTargetSearch(
  id: ProviderId,
  query: string,
): Promise<{ ok: boolean; candidates: readonly TargetCandidate[]; message?: string }> {
  const trimmed = query.trim()

  if (!trimmed) {
    const cached = await targetCache.read(id)
    if (cached) return { ok: true, candidates: cached }
  }

  const provider = await resolveProvider(id, tokens, accounts)
  if (!provider) {
    return { ok: false, candidates: [], message: `${id} is not connected.` }
  }

  const result = await provider.searchTargets(trimmed)
  if (isErr(result)) {
    // A picker that cannot reach the service is a degradation, not a dead end:
    // the caller still offers raw-id entry (FR-41's escape hatch).
    return { ok: false, candidates: [], message: result.error.message }
  }

  if (!trimmed) await targetCache.write(id, result.value)
  return { ok: true, candidates: result.value }
}

/** Called when a token is revoked: cached titles are account data. */
export async function forgetTargets(id: ProviderId): Promise<void> {
  await targetCache.clear(id)
}

export interface ShipRequest {
  readonly provider: ProviderId
  readonly key: string
  /**
   * The capture as a PNG or JPEG data URL.
   *
   * NOT an ArrayBuffer: `sendMessage` is JSON-serialised, so a buffer arrives
   * as `{}` and would be uploaded as the string "[object Object]". JPEG is
   * accepted as well as PNG because a capture over a destination's attachment
   * limit is compressed before it is sent (`export-plan`).
   */
  readonly dataUrl: string
  readonly url: string
  readonly title: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly devicePixelRatio: number
}

/** PNG or JPEG only: this value is fetched, and must not be able to be a URL. */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/

export interface ShipOutcome {
  readonly ok: boolean
  readonly message: string
  readonly url?: string
  readonly destination?: { provider: ProviderId; key: string; url?: string }
}

export async function handleShip(request: ShipRequest): Promise<ShipOutcome> {
  const provider = await resolveProvider(request.provider, tokens, accounts)
  if (!provider) {
    return { ok: false, message: `${request.provider} is not connected. Add a token in Settings.` }
  }

  if (typeof request.dataUrl !== 'string' || !IMAGE_DATA_URL.test(request.dataUrl)) {
    // Refused rather than uploaded: shipping a malformed payload attaches
    // something that is not an image, which is worse than failing.
    return { ok: false, message: 'The capture could not be read for sending.' }
  }
  const blob = await (await fetch(request.dataUrl)).blob()

  const result = await shipCapture(
    request.provider,
    { key: request.key },
    blob,
    {
      url: request.url,
      title: request.title,
      viewportWidth: request.viewportWidth,
      viewportHeight: request.viewportHeight,
      devicePixelRatio: request.devicePixelRatio,
      // Read here rather than in the page: the user agent the service should
      // see is the browser's, and the page can lie about its own.
      userAgent: navigator.userAgent,
      capturedAt: new Date(),
    },
    {
      provider,
      settings: await settings.read(),
      linkContext: { jiraSite: (await accounts.jira())?.site },
      rememberTarget,
      lastTarget,
    },
  )

  if (isErr(result)) return { ok: false, message: result.error.message }

  // The link IS the share link (see ship.ts) — hand it back so the editor can
  // offer to copy it. Hotshot hosts nothing and still produces a URL.
  return {
    ok: true,
    message: 'Sent',
    url: result.value.url,
    // Returned so the caller can record the outcome against the capture in
    // history, which is what makes "send it there again" possible (FR-25).
    destination: { provider: request.provider, key: request.key, url: result.value.url },
  }
}
