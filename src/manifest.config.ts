import type { ManifestV3Export } from '@crxjs/vite-plugin'
import pkg from '../package.json'

/**
 * The single source of truth for permissions (Architecture §3).
 *
 * PRD FR-23 / §6.4: `activeTab` + `scripting` only. `<all_urls>` is NOT
 * requested — install-time permission breadth is the main reason users
 * distrust this category, and the store listing's privacy claim has to be
 * verifiable by a reviewer reading this file.
 *
 * Integration hosts are OPTIONAL and requested at token-setup time, never at
 * install. `clipboardWrite` is absent deliberately: FR-42 writes from the
 * content script inside a user gesture, which needs no permission.
 */
const manifest: ManifestV3Export = {
  manifest_version: 3,
  // i18n: Chrome substitutes these from _locales/<lang>/messages.json.
  name: '__MSG_extName__',
  // Single-sourced from package.json so the two can never disagree.
  version: pkg.version,
  description: '__MSG_extDescription__',
  minimum_chrome_version: '116',
  default_locale: 'en',

  // `notifications` backs FR-30's second layer: a keyboard-triggered command
  // does not open the popup, so on a restricted page the badge and a
  // notification are the only surfaces that can carry the reason.
  /**
   * `unlimitedStorage` is here for the library, not for ambition.
   *
   * Captures are stored as blobs in IndexedDB, and the library's own budget is
   * 256 MB. Without this, Chrome evicts under quota pressure — which would
   * silently delete someone's captures, the one thing a local-first library
   * must never do. It carries no install-time warning.
   */
  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'unlimitedStorage',
    'downloads',
    'offscreen',
    'notifications',
  ],
  /**
   * Every integration host is OPTIONAL and requested at token-setup time.
   *
   * The list grows with the destinations, and each entry is still granted only
   * when a user connects that service — an eight-host install prompt would
   * undo the reason there is no `<all_urls>` here in the first place (FR-23).
   */
  optional_host_permissions: [
    'https://*.atlassian.net/*',
    'https://api.notion.com/*',
    'https://api.clickup.com/*',
    'https://slack.com/*',
    // Slack issues upload URLs on its own file host, so the upload leg needs
    // that origin as well as the API's.
    'https://files.slack.com/*',
    'https://api.linear.app/*',
    // Linear's `fileUpload` returns a pre-signed URL on its asset host.
    'https://uploads.linear.app/*',
    'https://api.trello.com/*',
    'https://app.asana.com/*',
    'https://api.dropboxapi.com/*',
    'https://content.dropboxapi.com/*',
  ],

  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },

  background: { service_worker: 'src/worker/index.ts', type: 'module' },
  action: {
    default_title: '__MSG_extName__',
    default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
    default_popup: 'src/ui/popup/index.html',
  },
  options_page: 'src/ui/settings/index.html',

  // Chrome allows only four suggested key defaults. All four go to capture
  // modes; the pin is handled in-page and needs no command slot (FR-44).
  commands: {
    'capture-region': {
      suggested_key: { default: 'Ctrl+Shift+1', mac: 'Command+Shift+1' },
      description: '__MSG_cmdRegion__',
    },
    'capture-fullpage': {
      suggested_key: { default: 'Ctrl+Shift+2', mac: 'Command+Shift+2' },
      description: '__MSG_cmdFullPage__',
    },
    'capture-element': {
      suggested_key: { default: 'Ctrl+Shift+3', mac: 'Command+Shift+3' },
      description: '__MSG_cmdElement__',
    },
    'capture-last': {
      suggested_key: { default: 'Ctrl+Shift+4', mac: 'Command+Shift+4' },
      description: '__MSG_cmdLast__',
    },
  },

  // FR-26: captures taken in Incognito are never written to history.
  incognito: 'split',
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
}

export default manifest
