import { useEffect, useState } from 'preact/hooks'
import { createSettingsRepo, DEFAULT_SETTINGS, type Settings as SettingsShape } from '../../storage/settings-repo'
import { chromeLocalArea } from '../../storage/token-repo'
import { renderFilename } from '../../storage/filename'
import { ServiceBlock } from './ServiceBlock'

/**
 * Settings (DESIGN §3.6): a document with bordered service blocks, not a grid
 * of cards. Left-aligned, dense, no hero.
 */

const AUTO_CONTEXT_FIELDS: ReadonlyArray<[keyof SettingsShape['autoContext'], string, string]> = [
  ['url', 'Page URL', 'The single most useful line in a bug report.'],
  ['title', 'Page title', ''],
  ['viewport', 'Viewport size', '“Works on my machine” is a viewport argument half the time.'],
  ['devicePixelRatio', 'Device pixel ratio', ''],
  ['timestamp', 'Capture time', ''],
  ['userAgent', 'User agent', 'Off by default — PII-adjacent in some organisations.'],
]

export function Settings() {
  const repo = createSettingsRepo(chromeLocalArea())
  const [settings, setSettings] = useState<SettingsShape>(DEFAULT_SETTINGS)
  // FR-4: the delay lives outside Settings because the service worker reads it
  // on the command path, where a schema parse would be dead weight.
  const [delaySeconds, setDelaySeconds] = useState(0)

  useEffect(() => {
    void repo.read().then(setSettings)
    void chrome.storage.local
      .get(['hotshot.delaySeconds'])
      .then((stored) => setDelaySeconds(Number(stored['hotshot.delaySeconds'] ?? 0)))
  }, [])

  async function patch(update: Partial<SettingsShape>) {
    // Optimistic, then persisted: a settings page that lags behind the click
    // feels broken even when it is correct.
    setSettings((current) => ({ ...current, ...update }))
    await repo.update(update)
  }

  const filenamePreview = renderFilename(settings.filenameTemplate, {
    title: 'Order 412 — Acme',
    host: 'example.com',
    date: '2026-09-02',
    time: '14-30-05',
    sequence: 1,
  })

  return (
    <main style={{ maxWidth: 640, padding: '28px 24px 64px' }}>
      <h1 style={{ fontSize: 20 }}>Hotshot</h1>
      <p style={{ maxWidth: 460 }}>
        Nothing leaves your machine except the call to a service you have connected below.
      </p>

      <section style={{ marginTop: 28 }}>
        <h2>Capture</h2>
        <div style={{ border: '1px solid var(--hs-border)', borderRadius: 'var(--hs-r-2)' }}>
          <div class="row">
            <label for="mode">Default mode</label>
            <select
              id="mode"
              value={settings.defaultMode}
              onChange={(e) => void patch({ defaultMode: (e.target as HTMLSelectElement).value as SettingsShape['defaultMode'] })}
            >
              <option value="region">Region</option>
              <option value="fullpage">Full page</option>
              <option value="element">Element</option>
            </select>
          </div>
          <div class="row">
            <label for="delay" style={{ display: 'grid', gap: 2 }}>
              <span>Delay for keyboard shortcuts</span>
              <span class="dim" style={{ fontSize: 11 }}>
                The popup asks per capture; a shortcut cannot, so it uses this.
              </span>
            </label>
            <select
              id="delay"
              value={String(delaySeconds)}
              onChange={(e) => {
                const value = Number((e.target as HTMLSelectElement).value)
                setDelaySeconds(value)
                void chrome.storage.local.set({ 'hotshot.delaySeconds': value })
              }}
            >
              <option value="0">None</option>
              <option value="3">3 seconds</option>
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
            </select>
          </div>
          <div class="row">
            <label for="retention">Keep history for</label>
            <select
              id="retention"
              value={settings.retention}
              onChange={(e) => void patch({ retention: (e.target as HTMLSelectElement).value as SettingsShape['retention'] })}
            >
              <option value="session">This session only</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Filename</h2>
        <div style={{ border: '1px solid var(--hs-border)', borderRadius: 'var(--hs-r-2)', padding: 14 }}>
          <input
            class="mono"
            style={{ width: '100%' }}
            value={settings.filenameTemplate}
            onInput={(e) => void patch({ filenameTemplate: (e.target as HTMLInputElement).value })}
          />
          {/* The preview shows the SANITISED result, so the sanitiser is never
              a surprise at download time. */}
          <p class="num" style={{ margin: '8px 0 0', fontSize: 11 }}>{filenamePreview}</p>
          <p class="dim" style={{ margin: '6px 0 0', fontSize: 11 }}>
            {'{title} {host} {date} {time} {n}'}
          </p>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Context attached to tickets</h2>
        <div style={{ border: '1px solid var(--hs-border)', borderRadius: 'var(--hs-r-2)' }}>
          {AUTO_CONTEXT_FIELDS.map(([field, label, note]) => (
            <div class="row" key={field}>
              <label for={field} style={{ display: 'grid', gap: 2 }}>
                <span>{label}</span>
                {note ? <span class="dim" style={{ fontSize: 11 }}>{note}</span> : null}
              </label>
              <input
                id={field}
                type="checkbox"
                checked={settings.autoContext[field]}
                onChange={(e) =>
                  void patch({
                    autoContext: {
                      ...settings.autoContext,
                      [field]: (e.target as HTMLInputElement).checked,
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Connected services</h2>
        <p style={{ fontSize: 11 }}>
          Tokens are stored on this machine only, never synced. Each token is unscoped and
          carries your full account permissions — revoke it here or at the service at any time.
        </p>
        <ServiceBlock id="jira" name="Jira" />
        <ServiceBlock id="clickup" name="ClickUp" />
        <ServiceBlock id="notion" name="Notion" />
        <ServiceBlock id="linear" name="Linear" />
        <ServiceBlock id="slack" name="Slack" />
        <ServiceBlock id="trello" name="Trello" />
        <ServiceBlock id="asana" name="Asana" />
        <ServiceBlock id="dropbox" name="Dropbox" />
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Shortcuts</h2>
        <div class="row" style={{ border: '1px solid var(--hs-border)', borderRadius: 'var(--hs-r-2)' }}>
          <span class="dim" style={{ fontSize: 11 }}>Chrome owns keyboard shortcuts.</span>
          <button onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            Change shortcuts
          </button>
        </div>
      </section>
    </main>
  )
}
