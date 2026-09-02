import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath } from 'node:url'
import manifest from './src/manifest.config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [crx({ manifest })],
  build: {
    target: 'es2022',
    emptyOutDir: true,
    // Chrome serves extension pages in a different world from the one the
    // preload scanner assumes, so every <link rel="modulepreload"> is fetched
    // and then discarded — "cross-world extension resource mismatch" in the
    // console. The pages are local and already tiny, so preloading buys
    // nothing here even when it works.
    modulePreload: false,
    rollupOptions: {
      // The content script is injected programmatically under `activeTab`
      // rather than declared with `matches`, which would require the broad
      // host permission FR-23 refuses. It therefore needs its own entry with
      // a STABLE filename for `executeScript` to reference.
      input: {
        // NOTE: the content script is NOT built here. It must be a classic,
        // self-contained script (see scripts/build-content.mjs), and rollup
        // would code-split it into ES modules that executeScript cannot load.
        // The offscreen document is loaded by the extension at runtime, so it
        // is not reachable from the manifest graph and needs an explicit entry.
        offscreen: fileURLToPath(new URL('./src/offscreen/index.html', import.meta.url)),
        library: fileURLToPath(new URL('./src/ui/library/index.html', import.meta.url)),
        onboarding: fileURLToPath(new URL('./src/ui/onboarding/index.html', import.meta.url)),
      },
      output: { entryFileNames: 'assets/[name]-[hash].js' },
    },
  },
})
