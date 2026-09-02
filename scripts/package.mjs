import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Produces a Chrome Web Store upload package.
 *
 * The store expects `manifest.json` at the ARCHIVE ROOT, not inside a folder —
 * zipping the `dist` directory itself produces a package that is rejected with
 * an unhelpful error, so this zips its CONTENTS.
 *
 * Everything here is a pre-flight check rather than a convenience: a rejected
 * submission costs another review cycle (PRD R-6 budgets two weeks for one).
 */

const DIST = 'dist'
const OUT_DIR = 'release'

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

if (!existsSync(DIST)) fail(`No ${DIST}/ directory. Run \`npm run build\` first.`)

const manifestPath = join(DIST, 'manifest.json')
if (!existsSync(manifestPath)) fail(`${manifestPath} is missing — the build did not complete.`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const version = manifest.version
if (!/^\d+(\.\d+){0,3}$/.test(version ?? '')) {
  fail(`Manifest version "${version}" is not a valid store version (1-4 dot-separated integers).`)
}

// --- Pre-flight checks -------------------------------------------------------

const problems = []

// The content script is injected as a classic script; module syntax there is a
// runtime SyntaxError that stops it loading at all.
const contentPath = join(DIST, 'content.js')
if (!existsSync(contentPath)) {
  problems.push('dist/content.js is missing — run `node scripts/build-content.mjs`.')
} else {
  const source = readFileSync(contentPath, 'utf8')
  if (/(^|[;}\s])import\s*[{*'"(]/.test(source) || /(^|[;}\s])export\s/.test(source)) {
    problems.push('dist/content.js contains module syntax and would fail to inject.')
  }
}

// The privacy claim in the listing has to be true of the artefact being shipped.
if ((manifest.permissions ?? []).includes('<all_urls>')) {
  problems.push('Manifest requests <all_urls>, which contradicts the listing’s privacy claim.')
}
if ((manifest.host_permissions ?? []).length > 0) {
  problems.push('Manifest requests host_permissions at install; these must stay optional.')
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const files = walk(DIST)

// Source maps expose the full original source and inflate the package.
const maps = files.filter((f) => f.endsWith('.map'))
if (maps.length > 0) {
  problems.push(`${maps.length} source map(s) in dist/ — remove before shipping.`)
}

// Nothing test-shaped should ever reach a user.
const strays = files.filter((f) => /\.(test|spec)\./.test(f) || f.includes('harness'))
if (strays.length > 0) {
  problems.push(`Test artefacts in dist/: ${strays.map((f) => relative(DIST, f)).join(', ')}`)
}

if (problems.length > 0) {
  console.error('\nPackage refused:\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error('')
  process.exit(1)
}

// --- Build the archive -------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true })
const zipPath = join(OUT_DIR, `hotshot-${version}.zip`)
rmSync(zipPath, { force: true })

try {
  execFileSync(
    'zip',
    // -r recurse, -q quiet, -X strip extra file attributes (smaller, reproducible).
    ['-r', '-q', '-X', join('..', zipPath), '.'],
    { cwd: DIST, stdio: ['ignore', 'inherit', 'inherit'] },
  )
} catch {
  fail('`zip` is not available on this system. Install it, or archive dist/ manually.')
}

const sizeKb = statSync(zipPath).size / 1024
console.log(`\n  ${zipPath}`)
console.log(`  version   ${version}`)
console.log(`  files     ${files.length}`)
console.log(`  size      ${sizeKb.toFixed(1)} KB`)
console.log(`\n  Upload at https://chrome.google.com/webstore/devconsole`)
console.log(`  Listing copy and permission justifications: docs/STORE.md\n`)
