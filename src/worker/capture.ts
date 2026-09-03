import { restrictionFor } from './restricted-page'
import { registerBackdropRoute } from './backdrop'
import { clearBadge, reportRestriction } from './badge'
import { captureFullPage, type ElementBox } from './fullpage'
import { resolveDelay } from '../shared/delay'
import { parseEnvelope, type CaptureMode } from '../shared/messaging/protocol'
import { isErr } from '../shared/result'

/**
 * Capture orchestration (PRD FR-1..FR-5, FR-30, FR-40).
 *
 * Split out of `index.ts` so that file is only event registration. This is the
 * half that decides what gets captured, paces the stitch against Chrome's
 * throttle, and gets the result back into the page. It owns no durable state:
 * MV3 may terminate the worker between any two events.
 */

/**
 * Service worker: event wiring only (Architecture §3).
 *
 * It owns NO durable in-memory state. MV3 may terminate it between any two
 * events, so anything that must survive lives in `chrome.storage`.
 */

const COMMAND_MODES: Record<string, CaptureMode> = {
  'capture-region': 'region',
  'capture-fullpage': 'fullpage',
  'capture-element': 'element',
}

/** FR-4: delayed capture, with a visible countdown in the badge. */
const DELAY_KEY = 'hotshot.delaySeconds'

/**
 * The stored default, used only when the request could not carry a choice.
 *
 * A keyboard command cannot express one, so it falls back here; the popup
 * always sends an explicit value, including an explicit zero.
 */
async function readDefaultDelay(): Promise<unknown> {
  const stored = await chrome.storage.local.get([DELAY_KEY])
  return stored[DELAY_KEY]
}

/**
 * Counts down in the action badge before capturing (FR-4).
 *
 * The countdown is the whole point: it exists so the user can open a hover
 * state or a menu that would vanish on click, and they need to see how long
 * they have.
 */
async function countdown(tabId: number, seconds: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF5A00' })
  for (let remaining = seconds; remaining > 0; remaining--) {
    await chrome.action.setBadgeText({ tabId, text: String(remaining) })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  await chrome.action.setBadgeText({ tabId, text: '' })
}

const LAST_MODE_KEY = 'hotshot.lastMode'

async function readLastMode(): Promise<CaptureMode> {
  const stored = await chrome.storage.local.get([LAST_MODE_KEY])
  const value = stored[LAST_MODE_KEY]
  return value === 'region' || value === 'fullpage' || value === 'element' ? value : 'region'
}

async function beginCapture(
  mode: CaptureMode,
  tab: chrome.tabs.Tab,
  requestedDelay?: unknown,
): Promise<void> {
  const tabId = tab.id
  if (tabId === undefined) return

  const restriction = restrictionFor(tab.url)
  if (restriction) {
    await reportRestriction(tabId, restriction.message)
    return
  }
  await clearBadge(tabId)

  await chrome.storage.local.set({ [LAST_MODE_KEY]: mode })

  const delaySeconds = resolveDelay(requestedDelay, await readDefaultDelay())
  if (delaySeconds > 0) await countdown(tabId, delaySeconds)

  // Full page needs no overlay: there is nothing for the user to select, so
  // it runs straight through the offscreen stitcher.
  if (mode === 'fullpage') {
    await runStitch(tabId, tab.windowId)
    return
  }

  // `activeTab` is granted by this command invocation, and only for this tab.
  // It is the reason no host permission is requested at install (FR-23).
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  })

  await chrome.tabs.sendMessage(tabId, { kind: 'capture/begin', mode, tabId })
}

/**
 * Runs a scroll-and-stitch capture and delivers it.
 *
 * Shared by full-page (FR-2) and tall-element (FR-5) capture, because after
 * pixel acquisition they are the same product: stitch, then hand to the editor
 * for annotation and a destination. The only difference is the bounding box.
 */
async function runStitch(tabId: number, windowId: number, box?: ElementBox): Promise<void> {
  const label = box ? 'Element capture' : 'Full-page capture'
  try {
    const { dataUrl, partialWarning } = await captureFullPage(
      tabId,
      windowId,
      ({ captured, total }) => {
        void chrome.action.setBadgeText({ tabId, text: `${captured}/${total}` })
      },
      box,
    )
    await chrome.action.setBadgeText({ tabId, text: '' })
    await deliverFullPage(tabId, dataUrl, partialWarning)
    if (partialWarning) {
      // A partial delivery is a normal outcome, but the user must be told it
      // is partial — a silently short screenshot is a wrong screenshot.
      await reportRestriction(tabId, `${label} stopped early — ${partialWarning}.`)
    }
  } catch (error) {
    await chrome.action.setBadgeText({ tabId, text: '' })
    await reportRestriction(tabId, error instanceof Error ? error.message : `${label} failed.`)
  }
}

/**
 * Hands the finished stitch back to the page so it enters the SAME pipeline as
 * region and element captures: editor → annotate → destination, with history
 * written by the editor's own commit.
 *
 * The direct download survives as a fallback rather than as the default. If
 * the editor cannot be mounted — no reply, a torn-down tab, a page that
 * refuses injection — the user still gets their PNG, because a capture that
 * took 17 seconds of scrolling must never be discarded over a UI failure.
 */
async function deliverFullPage(
  tabId: number,
  dataUrl: string,
  partialWarning: string | null,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    const reply: unknown = await chrome.tabs.sendMessage(tabId, {
      kind: 'capture/stitched',
      dataUrl,
      partialWarning,
    })
    if ((reply as { ok?: unknown } | undefined)?.ok === true) return
  } catch (error: unknown) {
    console.warn(
      `[Hotshot] could not hand the stitch to the editor; falling back to a download. ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  await downloadInPage(tabId, dataUrl)
}

/**
 * The fallback delivery. Runs in the page because a download must start from a
 * document — the same focus rule that governs the clipboard.
 */
async function downloadInPage(tabId: number, dataUrl: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [dataUrl],
    func: (url: string) => {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${location.hostname}-fullpage.png`
      anchor.click()
    },
  })
}


/**
 * A tall element, handed back by the page for a bounded stitch (FR-5).
 *
 * The page cannot capture pixels and the worker cannot measure the DOM, so
 * this is the seam: the page measures, the worker scrolls and stitches, and
 * the result comes back through `capture/stitched` like any other capture.
 */
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const parsed = parseEnvelope(message)
  if (isErr(parsed) || parsed.value.kind !== 'capture/element-band') {
    // Not ours. Returning undefined leaves the message to other listeners,
    // and a malformed envelope of another kind is theirs to reject.
    return undefined
  }

  const { top, left, width, height } = parsed.value
  const tabId = sender.tab?.id
  const windowId = sender.tab?.windowId
  if (tabId === undefined || windowId === undefined) return undefined

  void runStitch(tabId, windowId, { top, left, width, height })
  return undefined
})

/** Registers every capture-side listener. Called once, from `index.ts`. */
export function registerCaptureRoutes(): void {
  registerBackdropRoute()

  chrome.commands.onCommand.addListener((command, tab) => {
    if (!tab) return
    void (async () => {
      const mode = COMMAND_MODES[command] ?? (await readLastMode())
      await beginCapture(mode, tab)
    })()
  })

  // Only fires when no popup is set. Kept as the fallback for a build that
  // removes `default_popup`, and harmless otherwise.
  chrome.action.onClicked.addListener((tab) => {
    void beginCapture('region', tab)
  })

  /**
   * Capture requested from the popup.
   *
   * The popup closes the moment it is clicked, so this must resolve the tab
   * itself rather than trusting a tab id the popup may not have been able to
   * read — `tab.url` is unavailable without the `tabs` permission we do not
   * request, and the same limitation applies to what the popup can pass on.
   */
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as {
      kind?: string
      mode?: string
      delaySeconds?: unknown
      options?: unknown
    }
    if (msg?.kind !== 'popup/capture' && msg?.kind !== 'popup/record') return undefined

    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return

      if (msg.kind === 'popup/record') {
        if (msg.mode !== 'video' && msg.mode !== 'gif') return
        const restriction = restrictionFor(tab.url)
        if (restriction) {
          await reportRestriction(tab.id, restriction.message)
          return
        }
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
        await chrome.tabs.sendMessage(tab.id, {
          kind: 'record/begin',
          mode: msg.mode,
          options: msg.options,
        })
        return
      }

      const mode = msg.mode
      if (mode !== 'region' && mode !== 'fullpage' && mode !== 'element') return
      // The popup always sends an explicit delay, so its choice — including an
      // explicit "None" — overrides the stored default (FR-4).
      await beginCapture(mode, tab, msg.delaySeconds)
    })()

    return undefined
  })

}

export { beginCapture }
