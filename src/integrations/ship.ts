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
  readonly linkContext?: DeepLinkContext
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

/**
 * The share link, without a backend.
 *
 * Hotshot hosts nothing, so it cannot mint a URL of its own. It does not need
 * to: once a capture is attached, the DESTINATION is the host — a Jira issue,
 * a Notion page, a ClickUp task are all URLs the recipient can already open,
 * on a service they already trust and are already authenticated to.
 */
export interface DeepLinkContext {
  /** Explicitly `| undefined`: the site is genuinely unknown until Jira is configured. */
  readonly jiraSite?: string | undefined
}

function deepLink(id: ProviderId, key: string, context: DeepLinkContext): string {
  switch (id) {
    case 'jira':
      // Without the site we cannot build a URL, so return the key rather than
      // a plausible-looking link that goes nowhere.
      return context.jiraSite ? `https://${context.jiraSite}/browse/${key}` : key
    case 'clickup':
      return `https://app.clickup.com/t/${key}`
    case 'notion':
      // Notion page URLs are the id with dashes stripped.
      return `https://www.notion.so/${key.replaceAll('-', '')}`
    case 'linear':
      // The id is a UUID, and Linear resolves `/issue/<id>` from it.
      return `https://linear.app/issue/${key}`
    case 'trello':
      return `https://trello.com/c/${key}`
    case 'asana':
      return `https://app.asana.com/0/0/${key}`
    case 'slack':
    case 'dropbox':
      // Neither gives a link a recipient can open from what an upload
      // returns — Slack's permalink needs another call, and a Dropbox share
      // link needs a scope this token may not have. Returning the key is
      // honest; a plausible-looking URL that 404s is not.
      return key
  }
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

  // The suffix follows the BYTES: a capture compressed to JPEG to fit an
  // attachment limit must not be uploaded named `.png`, which is how a service
  // ends up refusing or mis-rendering a perfectly good image.
  const named =
    blob.type === 'image/jpeg' ? filename.replace(/\.png$/i, '.jpg') : filename

  const attached = await deps.provider.attachImage(resolved, blob, named)
  if (isErr(attached)) {
    // The connectors already write plain-language messages — Notion's 404 in
    // particular. Rewrapping them here would throw away the useful wording.
    return err({ kind: attached.error.kind, message: attached.error.message })
  }

  // Remembered only on success: a target that does not work would otherwise
  // reproduce the same failure on every later capture.
  await deps.rememberTarget(id, resolved)

  return ok({
    url: deepLink(id, resolved.key, deps.linkContext ?? {}),
    context: buildAutoContext(facts, deps.settings.autoContext),
  })
}
