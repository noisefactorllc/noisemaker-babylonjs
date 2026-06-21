#!/usr/bin/env node
// gen-programs.mjs [--dry] [--force] — emit canonical DSL programs for every renderable-2D
// effect missing one, from parity/catalog.json. Prefers each effect's authored defaultProgram;
// otherwise derives by role (generator / filter / mixer) using the proven corpus patterns.
//   node tools/catalog.mjs parity/catalog.json   # produce catalog first
//   node tools/gen-programs.mjs --dry            # preview
//   node tools/gen-programs.mjs                  # write parity/programs/<name>.dsl

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const catalog = JSON.parse(readFileSync(join(ROOT, 'parity', 'catalog.json'), 'utf8'))

const dry = process.argv.includes('--dry')
const force = process.argv.includes('--force')

function ensureRender (dsl) {
  return /(^|\n)\s*render\s*\(/.test(dsl) ? dsl : (dsl.replace(/\s*$/, '') + '\nrender(o0)\n')
}

const GENS = ['noise(seed: 1, scaleX: 50, scaleY: 50)', 'gradient(seed: 1)', 'cell(seed: 1)', 'shape(seed: 1)']

function scopeFor (ns) {
  // classicNoisedeck filters/mixers need synth generators in scope to feed them.
  return ns === 'synth' ? 'search synth' : `search synth, ${ns}`
}

function derive (r) {
  const seed = r.seed ? 'seed: 1' : ''
  if (r.role === 'generator') {
    const scope = r.ns === 'synth' ? 'search synth' : `search ${r.ns}`
    return `${scope}\n${r.func}(${seed}).write(o0)\nrender(o0)\n`
  }
  if (r.role === 'mixer') {
    const sps = (r.surfaceParams && r.surfaceParams.length) ? r.surfaceParams : ['tex']
    const setup = sps.map((sp, i) => `${GENS[i % GENS.length].replace('seed: 1', `seed: ${i + 1}`)}.write(o${i})`).join('\n')
    const args = sps.map((sp, i) => `${sp}: o${i}`).join(', ')
    const out = `o${sps.length}`
    // If the mixer also consumes the chain (inputTex), call it on a generator; else call it bare.
    const head = r.hasInputTex ? `${GENS[sps.length % GENS.length].replace('seed: 1', `seed: ${sps.length + 1}`)}.${r.func}(${args})` : `${r.func}(${args})`
    return `${scopeFor(r.ns)}\n${setup}\n${head}.write(${out})\nrender(${out})\n`
  }
  // filter
  return `${scopeFor(r.ns)}\nnoise(seed: 1, scaleX: 50, scaleY: 50).${r.func}().write(o0)\nrender(o0)\n`
}

function genDSL (r) {
  if (r.defaultProgram && r.defaultProgram.trim()) {
    return { dsl: ensureRender(r.defaultProgram.trim() + '\n'), src: 'default' }
  }
  return { dsl: derive(r), src: 'derived:' + r.role }
}

// Consider every renderable effect; the existsSync guard below (unless --force) keeps existing
// hand-/godot-authored programs untouched and only fills in absent ones.
const missing = catalog.filter(r => !r.staged && !r.error)
let written = 0
for (const r of missing) {
  const { dsl, src } = genDSL(r)
  const path = join(ROOT, 'parity', 'programs', `${r.progName}.dsl`)
  if (existsSync(path) && !force) continue
  if (dry) {
    process.stdout.write(`\n# ${r.progName}  (${r.ns}/${r.func}, ${src})\n${dsl}`)
  } else {
    writeFileSync(path, dsl)
    written++
  }
}
process.stderr.write(`[gen-programs] ${dry ? 'previewed' : 'wrote'} ${dry ? missing.length : written} programs (of ${missing.length} missing renderable)\n`)
