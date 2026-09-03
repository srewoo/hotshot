/**
 * The toolbar badge, which is FR-30's first layer.
 *
 * It needs no permission and always fires, which matters because a
 * keyboard-triggered command does not open the popup — the exact case that
 * generates the one-star reviews this category is full of. A notification is
 * attempted on top, and its absence is a degradation rather than a failure.
 */

/**
 * FR-30's first layer: badge text plus a tooltip. It needs no permission and
 * always fires, which matters because a keyboard-triggered command does not
 * open the popup — the exact case where the reason would otherwise be lost.
 */
export async function reportRestriction(tabId: number, message: string): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: '!' })
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#C4321E' })
  await chrome.action.setTitle({ tabId, title: `Hotshot — ${message}` })

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'Hotshot can’t capture this page',
      message,
    })
  } catch {
    // Notifications may be unavailable or denied. The badge above already
    // carries the reason, so this is a degradation, not a failure.
  }
}

export async function clearBadge(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: '' })
  await chrome.action.setTitle({ tabId, title: 'Hotshot' })
}
