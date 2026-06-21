#!/usr/bin/env node
// catalog.mjs — enumerate every reference effect, classify it (renderable-2D vs staged
// MRT/points/3D), extract its canonical defaultProgram, and report the gap vs parity/programs.
// Output: a JSON catalog on stdout (or to argv[0]) + a human summary on stderr.
// Env: NM_REFERENCE_ROOT (default ../../noisemaker)

import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REFERENCE_ROOT = process.env.NM_REFERENCE_ROOT ? resolve(process.env.NM_REFERENCE_ROOT) : resolve(__dirname, '..', '..', 'noisemaker')
const EFFECTS_DIR = join(REFERENCE_ROOT, 'shaders', 'effects')
const PROGRAMS_DIR = resolve(__dirname, '..', 'parity', 'programs')

const have = new Set(existsSync(PROGRAMS_DIR) ? readdirSync(PROGRAMS_DIR).filter(f => f.endsWith('.dsl')).map(f => f.slice(0, -4)) : [])

function classify (inst) {
  const passes = inst.passes || []
  let mrt = false; let points = false; let compute = false; let threeD = false
  for (const p of passes) {
    if (p.drawMode && p.drawMode !== 'render') points = points || (p.drawMode === 'points' || p.drawMode === 'billboards' || p.drawMode === 'triangles')
    if (p.type === 'compute') compute = true
    if (p.drawBuffers && p.drawBuffers > 1) mrt = true
    if (p.outputs && Object.keys(p.outputs).length > 1) mrt = true
    if (p.inputs && Object.values(p.inputs).some(v => /3d|3D|inputTex3d|volume/.test(String(v)) || /3d|3D/.test(String(v)))) threeD = true
  }
  return { mrt, points, compute, threeD }
}

const cats = {}
const rows = []
const namespaces = readdirSync(EFFECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
for (const ns of namespaces) {
  const nsDir = join(EFFECTS_DIR, ns)
  let names
  try { names = readdirSync(nsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch { continue }
  for (const dir of names) {
    const defPath = join(nsDir, dir, 'definition.js')
    try { statSync(defPath) } catch { continue }
    let inst
    try { const mod = await import(pathToFileURL(defPath).href); const def = mod.default; inst = (typeof def === 'function') ? new def() : def } catch (e) { rows.push({ ns, dir, error: String(e).split('\n')[0] }); continue }
    if (!inst) continue
    const func = inst.func || dir
    const inputs = (inst.passes || []).flatMap(p => Object.keys(p.inputs || {}))
    const hasInputTex = inputs.includes('inputTex')
    // True secondary inputs are globals declared `type: 'surface'` (e.g. blendMode `tex`,
    // channelCombine `rTex/gTex/bTex`) — NOT just any param whose name contains "tex".
    const surfaceParams = Object.entries(inst.globals || {}).filter(([, s]) => s && s.type === 'surface').map(([k]) => k)
    const c = classify(inst)
    const threeD = c.threeD || ns === 'synth3d' || ns === 'filter3d' || ns === 'render'
    const staged = c.mrt || c.points || c.compute || threeD
    // role: mixer (has surface params) / filter (chain input) / generator (neither)
    const role = surfaceParams.length ? 'mixer' : (hasInputTex ? 'filter' : 'generator')
    const progName = ns === 'classicNoisedeck' ? (func.startsWith('cnd') ? func : 'cnd_' + func) : func
    rows.push({
      ns, dir, func, progName, role, threeD, surfaceParams, hasInputTex,
      mrt: c.mrt, points: c.points, compute: c.compute, staged,
      hasDefault: !!inst.defaultProgram,
      defaultProgram: inst.defaultProgram || null,
      seed: !!(inst.globals && inst.globals.seed),
      have: have.has(progName)
    })
    const key = staged ? 'staged' : 'renderable'
    cats[key] = (cats[key] || 0) + 1
  }
}

const out = JSON.stringify(rows, null, 2)
if (process.argv[2]) writeFileSync(process.argv[2], out + '\n')
else process.stdout.write(out + '\n')

// summary
const renderable = rows.filter(r => !r.staged && !r.error)
const staged = rows.filter(r => r.staged && !r.error)
const missingRenderable = renderable.filter(r => !r.have)
const errs = rows.filter(r => r.error)
process.stderr.write(`\n=== CATALOG: ${rows.length} effects ===\n`)
process.stderr.write(`renderable(2D): ${renderable.length}  (have ${renderable.filter(r => r.have).length}, MISSING ${missingRenderable.length})\n`)
process.stderr.write(`staged(MRT/points/3D): ${staged.length}\n`)
process.stderr.write(`import errors: ${errs.length}\n`)
const byRole = {}
for (const r of missingRenderable) byRole[r.role] = (byRole[r.role] || 0) + 1
process.stderr.write(`missing-renderable by role: ${JSON.stringify(byRole)}  withDefaultProgram: ${missingRenderable.filter(r => r.hasDefault).length}\n`)
process.stderr.write(`missing-renderable names: ${missingRenderable.map(r => r.progName).join(' ')}\n`)
process.stderr.write(`\nstaged breakdown: MRT=${staged.filter(r => r.mrt).length} points=${staged.filter(r => r.points).length} compute=${staged.filter(r => r.compute).length} 3D=${staged.filter(r => r.threeD).length}\n`)
process.stderr.write(`staged names: ${staged.map(r => r.ns + '/' + r.progName).join(' ')}\n`)
