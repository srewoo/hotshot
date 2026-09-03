import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [file, x, y, w, h, scale] = process.argv.slice(2)
const out = '/private/tmp/claude-502/-Users-sharajrewoo-DemoReposQA-hotshot/bd7fe296-1b84-4004-962d-4c7e7fa9483b/scratchpad'
writeFileSync(`${out}/zoom.html`, `<style>html,body{margin:0;overflow:hidden;background:#222}
 img{position:absolute;left:0;top:0;transform:scale(${scale}) translate(${-x}px,${-y}px);transform-origin:0 0;image-rendering:pixelated}</style>
 <img src="${pathToFileURL(file).href}">`)
const b = await chromium.launch({ channel: 'chromium' })
const p = await b.newPage({ viewport: { width: Math.round(+w * +scale), height: Math.round(+h * +scale) } })
await p.goto(pathToFileURL(`${out}/zoom.html`).href)
await p.waitForTimeout(400)
await p.screenshot({ path: `${out}/zoom.png` })
await b.close()
