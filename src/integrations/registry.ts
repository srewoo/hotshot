import type { IntegrationProvider } from './provider'
import type { ProviderId, TokenRepo } from '../storage/token-repo'
import { createJiraProvider } from './jira/client'
import { createNotionProvider } from './notion/client'
import { createClickUpProvider } from './clickup/client'

/**
 * Resolves a configured provider (Architecture §4.2).
 *
 * Returns null rather than throwing when a service has no token: "not
 * configured" is an ordinary state — PRD §9 expects roughly 75% of users to
 * be in it permanently — and not an error to be handled.
 */

export interface JiraAccount {
  readonly site: string
  readonly email: string
}

/** Non-secret account details; the token itself lives only in TokenRepo. */
export interface AccountRepo {
  jira(): Promise<JiraAccount | null>
}

export async function resolveProvider(
  id: ProviderId,
  tokens: TokenRepo,
  accounts: AccountRepo,
  fetchImpl: typeof globalThis.fetch = fetch,
): Promise<IntegrationProvider | null> {
  const token = await tokens.get(id)
  if (!token) return null

  switch (id) {
    case 'jira': {
      // Jira needs the site and account email alongside the token, so an
      // orphaned token without them is treated as unconfigured.
      const account = await accounts.jira()
      if (!account) return null
      return createJiraProvider({ ...account, token }, fetchImpl)
    }
    case 'notion':
      return createNotionProvider({ token }, fetchImpl)
    case 'clickup':
      return createClickUpProvider({ token }, fetchImpl)
  }
}
