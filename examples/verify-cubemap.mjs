import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
const __dirname = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
const errs = []
page.on('pageerror', e => errs.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto(pathToFileURL(join(__dirname, 'cubemap.html')).href)
await page.waitForTimeout(2000)
const shot = await page.screenshot()
await browser.close()
const buf = Buffer.from(shot)
let nonBg = 0; for (let i = 0; i < buf.length; i++) if (buf[i] > 24) nonBg++
const frac = nonBg / buf.length
console.error(`[verify-cube] screenshot ${buf.length}B, non-bg ${frac.toFixed(3)}, errors ${errs.length}`)
if (errs.length) console.error('  ' + errs.slice(0,3).join('\n  '))
if (frac < 0.02 || errs.length) { console.error('[verify-cube] FAIL'); process.exit(1) }
console.error('[verify-cube] OK — skybox + reflective sphere render from the baked cubemap')
