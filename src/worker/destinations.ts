import { chromeLocalArea, createTokenRepo, type ProviderId } from '../storage/token-repo'
import { createSettingsRepo } from '../storage/settings-repo'
import { resolveProvider } from '../integrations/registry'
import { shipCapture } from '../integrations/ship'
import { isErr } from '../shared/result'
import type { TargetRef } from '../integrations/provider'

/**
 * Destination routing (PRD FR-13..FR-19).
 *
 * Lives in the worker because it owns tokens and network access — a content
 * script never holds a credential and never talks to a service directly. That
 * is what keeps a compromised page from reaching a user's Jira account.
 */

const PROVIDERS: readonly ProviderId[] = ['jira', 'clickup', 'notion']
const LAST_TARGET_PREFIX = 'hotshot.lastTarget.'

const area = chromeLocalArea()
const tokens = createTokenRepo(area)
const settings = createSettingsRepo(area)

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

export interface ShipRequest {
  readonly provider: ProviderId
  readonly key: string
  readonly blob: ArrayBuffer
  readonly url: string
  readonly title: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly devicePixelRatio: number
}

export async function handleShip(
  request: ShipRequest,
): Promise<{ ok: boolean; message: string }> {
  const provider = await resolveProvider(request.provider, tokens, accounts)
  if (!provider) {
    return { ok: false, message: `${request.provider} is not connected. Add a token in Settings.` }
  }

  const result = await shipCapture(
    request.provider,
    { key: request.key },
    new Blob([request.blob], { type: 'image/png' }),
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
      rememberTarget,
      lastTarget,
    },
  )

  if (isErr(result)) return { ok: false, message: result.error.message }
  return { ok: true, message: `Sent — ${result.value.url}` }
}
