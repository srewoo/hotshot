import { err, isErr, ok, type Result } from '../shared/result'
import type { IntegrationProvider, TargetRef } from './provider'
import type { ProviderId } from '../storage/token-repo'
import type { Settings } from '../storage/settings-repo'
import { buildAutoContext, renderTitle, type CaptureFacts } from '../shared/capture-context'
import { renderFilename } from '../storage/filename'

/**
 * The last mile (PRD FR-13..FR-19).
 *
 * Where the connector, the auto-context, the title template and the remembered
 * target finally meet. This is the step the product is positioned on: every
 * competitor ends at "image on clipboard or disk", and everything after that
 * is the 90 seconds Hotshot exists to remove.
 */

export interface ShipDeps {
  readonly provider: IntegrationProvider
  readonly settings: Settings
  rememberTarget(id: ProviderId, target: TargetRef): Promise<void>
  lastTarget(id: ProviderId): Promise<TargetRef | null>
}

export interface ShipSuccess {
  /** Deep link to the item, so the toast can point at it (FR-20). */
  readonly url: string
  readonly context: readonly string[]
}

export interface ShipFailure {
  readonly kind: string
  readonly message: string
}

const DEEP_LINK: Record<ProviderId, (key: string) => string> = {
  jira: (key) => `Issue ${key}`,
  notion: (key) => `Notion page ${key}`,
  clickup: (key) => `https://app.clickup.com/t/${key}`,
}

export async function shipCapture(
  id: ProviderId,
  target: TargetRef | null,
  blob: Blob,
  facts: CaptureFacts,
  deps: ShipDeps,
): Promise<Result<ShipSuccess, ShipFailure>> {
  // FR-19: not remembering is a bug, so the remembered target is the default
  // rather than a convenience.
  const resolved = target ?? (await deps.lastTarget(id))
  if (!resolved) {
    return err({
      kind: 'no-target',
      message: 'Choose where this capture should go, or paste an issue key.',
    })
  }

  const title = renderTitle(deps.settings.titleTemplate, facts)
  const iso = facts.capturedAt.toISOString()
  const filename = renderFilename(deps.settings.filenameTemplate.includes('{title}')
    ? deps.settings.filenameTemplate
    : '{title}-{date}', {
    title,
    host: new URL(facts.url).hostname,
    date: iso.slice(0, 10),
    time: iso.slice(11, 19).replaceAll(':', '-'),
    sequence: 1,
  })

  const attached = await deps.provider.attachImage(resolved, blob, filename)
  if (isErr(attached)) {
    // The connectors already write plain-language messages — Notion's 404 in
    // particular. Rewrapping them here would throw away the useful wording.
    return err({ kind: attached.error.kind, message: attached.error.message })
  }

  // Remembered only on success: a target that does not work would otherwise
  // reproduce the same failure on every later capture.
  await deps.rememberTarget(id, resolved)

  return ok({
    url: DEEP_LINK[id](resolved.key),
    context: buildAutoContext(facts, deps.settings.autoContext),
  })
}
