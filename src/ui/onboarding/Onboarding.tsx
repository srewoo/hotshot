import { useEffect, useState } from 'preact/hooks'

/**
 * First run (DESIGN §3.8, PRD §8).
 *
 * A live sandbox, not a video: each step is completed by actually doing it on
 * this page. No account, no email field, and integrations are never a gate —
 * PRD §9 expects most users never to configure one.
 */

const isMac = navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘⇧' : 'Ctrl+Shift+'

export function Onboarding() {
  const [done, setDone] = useState<Set<number>>(new Set())

  useEffect(() => {
    // A capture on this page marks its step complete — the page can tell,
    // because the overlay injects a marker attribute on documentElement.
    const observer = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-hotshot-overlay-seen')) {
        setDone((current) => new Set(current).add(1))
      }
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  const steps = [
    {
      n: 1,
      title: `Press ${mod}1 and drag a box`,
      body: 'That is region capture. Release, mark it up, then press Enter to save it.',
    },
    {
      n: 2,
      title: `Press ${mod}3 and hover the card below`,
      body: 'Element capture snaps to exact bounds — no shaky dragging. Use [ and ] to select its parent or child.',
    },
    {
      n: 3,
      title: 'Choose where captures go',
      body: 'Clipboard and download work with no setup at all. Connect Jira, Notion or ClickUp later, or never.',
    },
  ]

  return (
    <main style={{ maxWidth: 680, padding: '48px 24px 80px' }}>
      <h1 style={{ fontSize: 26, letterSpacing: '-0.02em' }}>Hotshot is installed</h1>
      <p style={{ maxWidth: 480, fontSize: 14 }}>
        Three things to try, right here on this page. Takes about a minute.
      </p>

      <ol style={{ listStyle: 'none', padding: 0, margin: '32px 0 0', display: 'grid', gap: 12 }}>
        {steps.map((step) => (
          <li
            key={step.n}
            style={{
              border: '1px solid var(--hs-border)',
              borderRadius: 'var(--hs-r-2)',
              padding: '14px 16px',
              display: 'grid',
              gridTemplateColumns: '28px 1fr',
              gap: 12,
              alignItems: 'start',
            }}
          >
            <span
              class="num"
              style={{
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 3,
                background: done.has(step.n) ? 'var(--hs-ok)' : 'var(--hs-flare)',
                color: '#fff',
                fontSize: 12,
              }}
            >
              {done.has(step.n) ? '✓' : step.n}
            </span>
            <span>
              <strong style={{ fontSize: 13 }}>{step.title}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 12 }}>{step.body}</p>
            </span>
          </li>
        ))}
      </ol>

      {/* The practice target for step 2 — a real card with real bounds. */}
      <section
        style={{
          marginTop: 28,
          border: '1px solid var(--hs-border)',
          borderRadius: 'var(--hs-r-2)',
          padding: 18,
          maxWidth: 380,
        }}
      >
        <h2 style={{ margin: 0 }}>Practice card</h2>
        <p style={{ margin: '8px 0 0', fontSize: 12 }}>
          Hover this card in element mode. Hotshot highlights its exact box — a desktop tool
          cannot do that, because it has no DOM to read.
        </p>
        <div class="num" style={{ marginTop: 12, fontSize: 11, color: 'var(--hs-ink-dim)' }}>
          380 × 148
        </div>
      </section>

      <div style={{ marginTop: 28, display: 'flex', gap: 8 }}>
        <button class="primary" onClick={() => void chrome.runtime.openOptionsPage()}>
          Open settings
        </button>
        <button onClick={() => window.close()}>Done</button>
      </div>
    </main>
  )
}
