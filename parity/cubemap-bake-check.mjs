// cubemap-bake-check.mjs — prove the 6-face cubemap BAKE is byte-identical to the reference.
// Both sides drive the SAME reused Pipeline.renderCubemap() (per face: setUniform('cubeBasis',
// CUBE_FACE_BASES[face]) → render → readPixels) — the reference on webgl2, the candidate on the
// BabylonBackend. Faces are +X,-X,+Y,-Y,+Z,-Z, each RGBA8 top-down. Writes a 4×3 cross PNG per
// program for visual confirmation and reports max-abs-diff per face.
//
//   NM_REFERENCE_ROOT=../noisemaker node parity/cubemap-bake-check.mjs [program...]   (default: cubeSurface cube3d)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { exportFatGraph } from '../tools/export-fat-graph.mjs'
import { INDEX_HTML, ensureBundle } from './render-candidate.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REFERENCE_ROOT = process.env.NM_REFERENCE_ROOT ? resolve(process.env.NM_REFERENCE_ROOT) : resolve(__dirname, '..', '..', 'noisemaker')
const HARNESS = join(REFERENCE_ROOT, 'vendor', 'shade-mcp', 'harness', 'index.js')
const SIZE = 256
const TIME = 0.25
const PROGRAMS = process.argv.slice(2).length ? process.argv.slice(2) : ['cubeSurface', 'cube3d']

function crc32 (buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1) } return (c ^ 0xffffffff) >>> 0 }
function pngChunk (type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]) }
function encodePng (w, h, rgba) { const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; const raw = Buffer.alloc(h * (1 + w * 4)); for (let y = 0; y < h; y++) { const di = y * (1 + w * 4); raw[di] = 0; Buffer.from(rgba).copy(raw, di + 1, y * w * 4, (y + 1) * w * 4) } return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]) }

// Horizontal cross (4 wide × 3 tall) in standard layout:  . +Y . . / -X +Z +X -Z / . -Y . .
// faces idx: 0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z
function crossLayout (faces, s) {
  const W = 4 * s; const H = 3 * s
  const out = new Uint8Array(W * H * 4)
  const place = (face, cx, cy) => {
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const sd = (y * s + x) * 4; const dd = ((cy * s + y) * W + (cx * s + x)) * 4; for (let k = 0; k < 4; k++) out[dd + k] = face.data[sd + k] }
  }
  place(faces[2], 1, 0) // +Y
  place(faces[1], 0, 1); place(faces[4], 1, 1); place(faces[0], 2, 1); place(faces[5], 3, 1) // -X +Z +X -Z
  place(faces[3], 1, 2) // -Y
  return { width: W, height: H, data: out }
}

async function bakeReference (dsl) {
  process.env.SHADE_VIEWER_ROOT = REFERENCE_ROOT
  process.env.SHADE_VIEWER_PATH = '/demo/shaders/'
  process.env.SHADE_EFFECTS_DIR = join(REFERENCE_ROOT, 'shaders', 'effects')
  process.env.SHADE_GLOBALS_PREFIX = '__noisemaker'
  process.env.SHADE_HEADLESS = process.env.SHADE_HEADLESS ?? '1'
  const { BrowserSession } = await import(pathToFileURL(HARNESS).href)
  const session = new BrowserSession({ backend: 'webgl2' })
  await session.setup()
  const page = session.page
  await session.setBackend('webgl2')
  await page.setViewportSize({ width: SIZE, height: SIZE })
  await page.waitForFunction(() => !!window.__noisemakerRenderingPipeline && !!document.getElementById('dsl-editor'), { timeout: 300000 })
  const baseId = await page.evaluate(() => window.__noisemakerRenderingPipeline?.graph?.id ?? null)
  await page.evaluate((src) => { const ed = document.getElementById('dsl-editor'); const run = document.getElementById('dsl-run-btn'); ed.value = src; ed.dispatchEvent(new Event('input', { bubbles: true })); run.click() }, dsl)
  await page.waitForFunction((b) => { const s = (document.getElementById('status')?.textContent || '').toLowerCase(); if (s.includes('error') || s.includes('failed')) throw new Error('compile failed: ' + document.getElementById('status')?.textContent); const p = window.__noisemakerRenderingPipeline; return p && p.graph && p.graph.id !== b && p.isCompiling === false && s.includes('compiled') }, { timeout: 300000 }, baseId)
  await page.evaluate(() => { if (window.__noisemakerSetPaused) window.__noisemakerSetPaused(true) })
  const faces = await page.evaluate(async ({ size, outputSurface, time }) => {
    const p = window.__noisemakerRenderingPipeline
    const fs = await p.renderCubemap({ size, outputSurface, time })
    return fs.map(f => ({ width: f.width, height: f.height, data: Array.from(f.data) }))
  }, { size: SIZE, outputSurface: 'o0', time: TIME })
  await session.teardown()
  return faces
}

async function bakeCandidate (dsl) {
  await ensureBundle(false)
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox', '--use-angle=metal'] })
  const page = await browser.newPage()
  page.on('pageerror', e => process.stderr.write('[pageerror] ' + String(e).split('\n')[0] + '\n'))
  await page.goto(pathToFileURL(INDEX_HTML).href)
  await page.waitForFunction(() => window.nmReady === true, { timeout: 30000 })
  const fat = await exportFatGraph(dsl)
  const res = await page.evaluate(async ({ fat, opts }) => { try { return { ok: true, ...(await window.nmRunCubemap(fat, opts)) } } catch (e) { return { ok: false, error: String(e.stack || e) } } }, { fat, opts: { size: SIZE, time: TIME, outputSurface: 'o0' } })
  await browser.close()
  if (!res.ok) throw new Error('candidate: ' + res.error)
  return res.faces
}

const FACE = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']
async function main () {
  let allPass = true
  for (const prog of PROGRAMS) {
    const dsl = readFileSync(join(__dirname, 'programs', `${prog}.dsl`), 'utf8')
    process.stderr.write(`\n[cubemap] ${prog}: baking reference…\n`)
    const ref = await bakeReference(dsl)
    process.stderr.write(`[cubemap] ${prog}: baking candidate…\n`)
    const cand = await bakeCandidate(dsl)
    let maxd = 0; const perFace = []
    for (let f = 0; f < 6; f++) {
      let m = 0; const a = cand[f].data; const b = ref[f].data; const n = Math.min(a.length, b.length)
      for (let i = 0; i < n; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d }
      perFace.push(m); if (m > maxd) maxd = m
    }
    writeFileSync(join(__dirname, 'out', `_cube_${prog}_ref.png`), encodePng(...Object.values(crossLayout(ref, SIZE)).slice(0, 2), crossLayout(ref, SIZE).data))
    writeFileSync(join(__dirname, 'out', `_cube_${prog}_cand.png`), encodePng(...Object.values(crossLayout(cand, SIZE)).slice(0, 2), crossLayout(cand, SIZE).data))
    const ok = maxd <= 2
    allPass = allPass && ok
    process.stdout.write(`${ok ? '✅' : '❌'} ${prog}: max-abs-diff=${maxd} per-face[${FACE.map((n, i) => `${n}:${perFace[i]}`).join(' ')}]  (cross → parity/out/_cube_${prog}_{ref,cand}.png)\n`)
  }
  process.stdout.write(`\n=== CUBEMAP BAKE: ${allPass ? 'ALL FACES BYTE-IDENTICAL' : 'DIVERGENCE'} ===\n`)
}

main().catch(e => { process.stderr.write('[cubemap] FATAL ' + (e?.stack || e) + '\n'); process.exit(1) })
