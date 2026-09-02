import { useEffect, useState } from 'preact/hooks'
import { chromeLocalArea, createTokenRepo, maskToken, type ProviderId } from '../../storage/token-repo'
import { resolveProvider } from '../../integrations/registry'
import { isErr } from '../../shared/result'

/**
 * One connected service (DESIGN §3.6, PRD FR-21/FR-23).
 *
 * "Test connection" runs a real identity call before Save is allowed. Silent
 * auth failure at ship time is the worst possible moment to discover a bad
 * token — the capture is already made and the user is already moving on.
 */

const HOSTS: Record<ProviderId, string> = {
  jira: 'https://*.atlassian.net/*',
  notion: 'https://api.notion.com/*',
  clickup: 'https://api.clickup.com/*',
}

const TOKEN_HELP: Record<ProviderId, string> = {
  jira: 'Create an API token at id.atlassian.com → Security → API tokens.',
  notion: 'Create an internal integration at notion.so/my-integrations, then invite it to each page you want to send to.',
  clickup: 'ClickUp → Settings → Apps → Generate a personal API token.',
}

type Status =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; who: string }
  | { state: 'error'; message: string }

export function ServiceBlock({ id, name }: { id: ProviderId; name: string }) {
  const tokens = createTokenRepo(chromeLocalArea())
  const [saved, setSaved] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  useEffect(() => {
    void tokens.get(id).then(setSaved)
  }, [id])

  async function test() {
    setStatus({ state: 'testing' })

    // Requested here, not at install: install-time permission breadth is the
    // main reason users distrust this category (FR-23).
    const granted = await chrome.permissions.request({ origins: [HOSTS[id]] })
    if (!granted) {
      setStatus({ state: 'error', message: `Hotshot needs permission to reach ${name}.` })
      return
    }

    const provider = await resolveProvider(
      id,
      { get: async () => token, set: async () => {}, revoke: async () => {} },
      { jira: async () => (site && email ? { site, email } : null) },
    )
    if (!provider) {
      setStatus({ state: 'error', message: 'Fill in every field above first.' })
      return
    }

    const result = await provider.testConnection()
    if (isErr(result)) {
      setStatus({ state: 'error', message: result.error.message })
      return
    }

    await tokens.set(id, token)
    if (id === 'jira') await chrome.storage.local.set({ 'hotshot.account.jira': { site, email } })
    setSaved(token)
    setToken('')
    setStatus({ state: 'ok', who: result.value.displayName })
  }

  async function revoke() {
    await tokens.revoke(id)
    // Hand the permission back too: keeping host access for a service the
    // user disconnected would make the privacy claim untrue.
    await chrome.permissions.remove({ origins: [HOSTS[id]] })
    setSaved(null)
    setStatus({ state: 'idle' })
  }

  return (
    <div
      style={{
        border: '1px solid var(--hs-border)',
        borderRadius: 'var(--hs-r-2)',
        marginTop: 10,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>{name}</strong>
        {saved ? (
          <span class="num dim" style={{ fontSize: 11 }}>{maskToken(saved)}</span>
        ) : (
          <span class="dim" style={{ fontSize: 11 }}>Not connected</span>
        )}
      </div>

      {saved ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => void revoke()}>Revoke &amp; delete</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <p class="dim" style={{ fontSize: 11, margin: 0 }}>{TOKEN_HELP[id]}</p>

          {id === 'jira' ? (
            <>
              <input
                class="mono"
                placeholder="your-site.atlassian.net"
                value={site}
                onInput={(e) => setSite((e.target as HTMLInputElement).value)}
              />
              <input
                class="mono"
                placeholder="you@company.com"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </>
          ) : null}

          <input
            class="mono"
            type="password"
            placeholder="API token"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              class="primary"
              disabled={token.length === 0 || status.state === 'testing'}
              onClick={() => void test()}
            >
              {status.state === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {status.state === 'error' ? (
              <span class="err" style={{ fontSize: 11 }}>{status.message}</span>
            ) : null}
            {status.state === 'ok' ? (
              <span class="ok" style={{ fontSize: 11 }}>Connected as {status.who}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
