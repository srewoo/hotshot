import { build } from 'esbuild'
import { statSync } from 'node:fs'

/**
 * Builds the content script as a self-contained IIFE.
 *
 * `chrome.scripting.executeScript({ files })` injects a CLASSIC script, not a
 * module — so any `import` in the output is a runtime SyntaxError and the
 * content script never loads at all. Vite code-splits by default and emitted
 * exactly that, which is why this is a separate esbuild pass rather than a
 * rollup entry: bundling to one file is a correctness requirement here, not a
 * size preference.
 */
const outfile = 'dist/content.js'

await build({
  entryPoints: ['src/content/index.ts'],
  outfile,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'error',
})

console.log(`${outfile}  ${(statSync(outfile).size / 1024).toFixed(1)} KB`)
