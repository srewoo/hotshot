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
  name: 'Hotshot',
  // Single-sourced from package.json so the two can never disagree.
  version: pkg.version,
  description: 'Exact screenshots of anything on a page. Nothing leaves your machine.',
  minimum_chrome_version: '116',

  // `notifications` backs FR-30's second layer: a keyboard-triggered command
  // does not open the popup, so on a restricted page the badge and a
  // notification are the only surfaces that can carry the reason.
  permissions: ['activeTab', 'scripting', 'storage', 'downloads', 'offscreen', 'notifications'],
  optional_host_permissions: [
    'https://*.atlassian.net/*',
    'https://api.notion.com/*',
    'https://api.clickup.com/*',
  ],

  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },

  background: { service_worker: 'src/worker/index.ts', type: 'module' },
  action: {
    default_title: 'Hotshot',
    default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
    default_popup: 'src/ui/popup/index.html',
  },
  options_page: 'src/ui/settings/index.html',

  // Chrome allows only four suggested key defaults. All four go to capture
  // modes; the pin is handled in-page and needs no command slot (FR-44).
  commands: {
    'capture-region': {
      suggested_key: { default: 'Ctrl+Shift+1', mac: 'Command+Shift+1' },
      description: 'Capture a region',
    },
    'capture-fullpage': {
      suggested_key: { default: 'Ctrl+Shift+2', mac: 'Command+Shift+2' },
      description: 'Capture the full page',
    },
    'capture-element': {
      suggested_key: { default: 'Ctrl+Shift+3', mac: 'Command+Shift+3' },
      description: 'Capture an element',
    },
    'capture-last': {
      suggested_key: { default: 'Ctrl+Shift+4', mac: 'Command+Shift+4' },
      description: 'Capture using the last mode',
    },
  },

  // FR-26: captures taken in Incognito are never written to history.
  incognito: 'split',
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
}

export default manifest
