import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
const b = await chromium.launch({ channel: 'chromium' })
const p = await b.newPage({ viewport: { width: 1152, height: 700 } })
await p.goto(pathToFileURL(process.cwd() + '/scripts/store/demo-bugform.html').href)
await p.waitForLoadState('load')
console.time('shot')
await p.screenshot({ timeout: 10000 })
console.timeEnd('shot')
await b.close()
