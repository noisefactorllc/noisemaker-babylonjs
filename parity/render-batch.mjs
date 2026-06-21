#!/usr/bin/env node
// render-batch.mjs [names...] [--all] [--size 256] [--time 0.25] [--frames 8]
//
// Renders many Babylon candidates in ONE headless-Chromium session (fast full sweep). Each
// program gets a fresh canvas/engine inside the page (disposed between runs). Writes
// parity/out/<name>.candidate.png for each. With --all (or no names), renders every program
// in parity/programs that has a golden.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { exportFatGraph } from '../tools/export-fat-graph.mjs'
import { ROOT, INDEX_HTML, encodePNG, ensureBundle } from './render-candidate.mjs'

// Effects that need TIME EVOLUTION to a steady state rather than a pinned frame: continuous
// solvers (Gray-Scott / Navier-Stokes). Run ~30s at the demo's natural rate (1/600 normalized
// per 60fps frame over a 10s loop); the chaotic transient washes out to a deterministic
// attractor that is bit-identical to the golden (same ANGLE/Metal driver). Goldens for these
// MUST be generated with the matching batch-golden --frames/--timestep.
const _EVO = { frames: 1800, timestep: 0.0016667 } // 30s at the demo's 1/600 rate
const EVOLVE = {
  reactionDiffusion: _EVO,
  navierStokes: _EVO,
  // agent/points sims also evolve to a deterministic steady state (the additive-deposit blend is
  // now exact — raw blendFunc(ONE,ONE) — so they're bit-reproducible, not chaotic).
  attractor: _EVO, buddhabrot: _EVO, dla: _EVO, flock: _EVO, flow: _EVO,
  hydraulic: _EVO, lenia: _EVO, life: _EVO, physarum: _EVO, physical: _EVO,
  // the complex emergent end-to-end test target (particles + navierStokes + lens stack).
  target: _EVO, target_particles: _EVO
}

function parse (argv) {
  const o = { size: 256, time: 0.25, frames: 8, names: [], all: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--size') o.size = +argv[++i]
    else if (k === '--time') o.time = +argv[++i]
    else if (k === '--frames') o.frames = +argv[++i]
    else if (k === '--all') o.all = true
    else o.names.push(k)
  }
  return o
}

async function main () {
  const o = parse(process.argv.slice(2))
  let names = o.names
  if (o.all || names.length === 0) {
    names = readdirSync(join(ROOT, 'parity', 'programs'))
      .filter(f => f.endsWith('.dsl')).map(f => f.slice(0, -4))
      .filter(n => existsSync(join(ROOT, 'parity', 'out', `${n}.golden.png`)))
      .sort()
  }

  await ensureBundle(false)
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu-sandbox', '--use-angle=metal'] })
  let ok = 0; let err = 0; const failed = []
  try {
    const page = await browser.newPage()
    page.on('pageerror', e => process.stderr.write('[pageerror] ' + e + '\n'))
    await page.goto(pathToFileURL(INDEX_HTML).href)
    await page.waitForFunction(() => window.nmReady === true, { timeout: 30000 })

    for (const name of names) {
      const dslPath = join(ROOT, 'parity', 'programs', `${name}.dsl`)
      if (!existsSync(dslPath)) continue
      try {
        const fat = await exportFatGraph(readFileSync(dslPath, 'utf8'))
        const ev = EVOLVE[name]
        const opts = { size: o.size, time: o.time, frames: ev ? ev.frames : o.frames, timestep: ev ? ev.timestep : 0 }
        const res = await page.evaluate(async ({ fat, opts }) => {
          try { return { ok: true, ...(await window.nmRunFatGraph(fat, opts)) } } catch (e) { return { ok: false, error: String((e && e.stack) || e) } }
        }, { fat, opts })
        if (!res.ok) { failed.push(name); err++; process.stderr.write(`[batch] ERR  ${name}: ${res.error.split('\n')[0]}\n`); continue }
        writeFileSync(join(ROOT, 'parity', 'out', `${name}.candidate.png`), encodePNG(res.width, res.height, Uint8Array.from(res.data)))
        ok++; process.stderr.write(`[batch] ok   ${name}\n`)
      } catch (e) { failed.push(name); err++; process.stderr.write(`[batch] ERR  ${name}: ${String(e).split('\n')[0]}\n`) }
    }
  } finally {
    await browser.close()
  }
  process.stderr.write(`[batch] rendered ${ok}/${names.length}, errored ${err}${failed.length ? ' — ' + failed.join(' ') : ''}\n`)
}

main().catch(e => { process.stderr.write('[render-batch] FAILED: ' + (e?.stack || e) + '\n'); process.exit(1) })
