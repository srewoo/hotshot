import { build } from 'esbuild'
import { statSync } from 'node:fs'

/**
 * Builds the injected scripts as self-contained IIFEs.
 *
 * `chrome.scripting.executeScript({ files })` injects a CLASSIC script, not a
 * module — so any `import` in the output is a runtime SyntaxError and the
 * script never loads at all. Vite code-splits by default and emitted exactly
 * that, which is why this is a separate esbuild pass rather than a rollup
 * entry: bundling to one file per chunk is a correctness requirement here, not
 * a size preference.
 *
 * TWO chunks, deliberately (PRD §6):
 *
 *   content.js  the capture fast path — overlay, picker, geometry. Injected
 *               into every page a capture touches, and its parse time sits
 *               directly on FR-1's "interactive in 200 ms".
 *   editor.js   everything only needed once pixels exist — the annotation
 *               editor, pins, the recorder. Injected on demand by the worker
 *               when `editor-bridge` asks for it.
 *
 * They share one isolated-world global, which is how the handshake in
 * `editor-bridge.ts` works.
 */
const ENTRIES = [
  { entry: 'src/content/index.ts', outfile: 'dist/content.js' },
  { entry: 'src/content/editor-entry.ts', outfile: 'dist/editor.js' },
]

for (const { entry, outfile } of ENTRIES) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'error',
  })
  console.log(`${outfile}  ${(statSync(outfile).size / 1024).toFixed(1)} KB`)
}
