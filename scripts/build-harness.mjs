import { build } from 'esbuild'

/**
 * Bundles the picker harness as an IIFE so a fixture page can load it with a
 * plain <script>. Kept out of the extension build: it is test scaffolding and
 * must never ship.
 */
await build({
  entryPoints: ['e2e/harness/picker-harness.ts'],
  outfile: 'e2e/harness/bundle.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  logLevel: 'error',
})
console.log('e2e/harness/bundle.js')
