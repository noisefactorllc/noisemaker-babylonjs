#!/usr/bin/env node
// hero-shot.mjs — render examples/hero.dsl on a Babylon canvas, evolve it to the 30-second
// state, and screenshot the page (DSL + canvas side by side) to examples/hero.png.
//
//   node examples/hero-shot.mjs [--size 512] [--frames 1800]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { exportFatGraph } from '../tools/export-fat-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d }
const SIZE = arg('--size', 512)
const FRAMES = arg('--frames', 1800)

const dsl = readFileSync(join(__dirname, 'hero.dsl'), 'utf8')
const fat = await exportFatGraph(dsl)
await build({
  entryPoints: [join(__dirname, 'hero-present.js')], bundle: true, format: 'iife',
  outfile: join(__dirname, 'hero-bundle.js'), platform: 'browser', target: 'es2020', logLevel: 'warning'
})

// --disable-gpu-watchdog: a single heavy frame (navierStokes ×40 + ~1M particles) can exceed
// Chromium's GPU watchdog and get the GPU process killed mid-evolve. Disable it for this long run.
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu-sandbox', '--use-angle=metal', '--disable-gpu-watchdog', '--disable-dev-shm-usage']
})
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1180, height: 760 })
  page.on('pageerror', e => process.stderr.write('[pageerror] ' + e + '\n'))
  page.on('crash', () => process.stderr.write('[crash] page crashed\n'))
  page.on('console', m => { if (m.type() === 'error') process.stderr.write('[console] ' + m.text() + '\n') })
  await page.goto(pathToFileURL(join(__dirname, 'hero-present.html')).href)
  await page.waitForFunction(() => typeof window.runHero === 'function', { timeout: 30000 })
  await page.evaluate((d) => { document.getElementById('dsl').textContent = d.replace(/\n+$/, '') }, dsl)
  // AWAIT the evolve directly (the proven render-candidate pattern — page.evaluate has no timeout
  // and waits for the promise; no waitForFunction polling, which a long synchronous loop starves).
  process.stderr.write(`[hero] evolving ${FRAMES} frames @ ${SIZE}×${SIZE}…\n`)
  await page.evaluate(async ({ fat, size, frames }) => { await window.runHero(fat, { size, frames }) }, { fat, size: SIZE, frames: FRAMES })
  const err = await page.evaluate(() => window.__heroError)
  if (err) throw new Error('runHero failed: ' + err)
  const out = join(__dirname, 'hero.png')
  await page.screenshot({ path: out, fullPage: true })
  process.stderr.write(`[hero] wrote ${out}\n`)
} finally {
  await browser.close()
}
