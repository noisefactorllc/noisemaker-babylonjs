#!/usr/bin/env node
// export-fat-graph.mjs — produce a RUNNABLE render graph for the Babylon harness.
//
// The normalized golden graph.json (export-graph.mjs) is structure-only: it DROPS
// per-program shader source and even the effect program entries (only `blit` survives),
// because the foreign-language ports load their own ported shaders by progName. The
// Babylon port instead runs the *reference* engine itself, so it needs the RUNTIME graph
// WITH GLSL source attached to every program.
//
// This tool mirrors export-graph.mjs's effect registration, but additionally loads each
// effect's `glsl/<program>.glsl` into the instance BEFORE compileGraph (exactly what
// canvas.js loadEffectShaders does in the browser, so the expander attaches it to each
// program). It then serializes the runtime graph (passes + programs-with-source +
// textures + renderSurface) as a "fat graph" the harness reconstructs and feeds to a
// stock `new Pipeline(graph, BabylonBackend)`.
//
// Usage:
//   node export-fat-graph.mjs "<dsl>" [out.json]
//   node export-fat-graph.mjs --file program.dsl [out.json]
// Env: NM_REFERENCE_ROOT (default ../../noisemaker)

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REFERENCE_ROOT = process.env.NM_REFERENCE_ROOT
  ? resolve(process.env.NM_REFERENCE_ROOT)
  : resolve(__dirname, '..', '..', 'noisemaker')
const SRC_INDEX = join(REFERENCE_ROOT, 'shaders', 'src', 'index.js')
const EFFECTS_DIR = join(REFERENCE_ROOT, 'shaders', 'effects')

let _booted = null
async function bootstrap () {
  if (_booted) return _booted
  const mod = await import(pathToFileURL(SRC_INDEX).href)
  const {
    compileGraph, registerEffect, registerOp, registerStarterOps,
    mergeIntoEnums, stdEnums, sanitizeEnumName
  } = mod

  if (mergeIntoEnums && stdEnums) await mergeIntoEnums(stdEnums)
  if (registerStarterOps) registerStarterOps()

  const allChoices = {}
  const namespaces = readdirSync(EFFECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name)

  for (const namespace of namespaces) {
    const nsDir = join(EFFECTS_DIR, namespace)
    let effectNames
    try {
      effectNames = readdirSync(nsDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name)
    } catch { continue }

    for (const name of effectNames) {
      const defPath = join(nsDir, name, 'definition.js')
      try { statSync(defPath) } catch { continue }
      let effectMod
      try {
        effectMod = await import(pathToFileURL(defPath).href)
      } catch (err) {
        process.stderr.write(`[fat-graph] skip ${namespace}/${name}: ${err?.message || err}\n`)
        continue
      }
      const def = effectMod.default
      const instance = (typeof def === 'function') ? new def() : def
      if (!instance) continue
      if (!instance.namespace) instance.namespace = namespace

      // Attach GLSL source to the instance (canvas.js loadEffectShaders, filesystem edition).
      // The expander spreads effectDef.shaders into each program, so compileGraph's runtime
      // graph carries the source.
      if (!instance.shaders) instance.shaders = {}
      const glslDir = join(nsDir, name, 'glsl')
      for (const pass of (instance.passes || [])) {
        const prog = pass.program
        if (!prog) continue
        const bucket = (instance.shaders[prog] ??= {})
        // Combined `.glsl` fragment, plus optional separate `.vert` (points/agent draws need a
        // custom vertex shader) and `.frag` (the {v,f} split form). Mirrors loadEffectShaders.
        const g = join(glslDir, `${prog}.glsl`); if (existsSync(g)) bucket.glsl = readFileSync(g, 'utf8')
        const v = join(glslDir, `${prog}.vert`); if (existsSync(v)) bucket.vertex = readFileSync(v, 'utf8')
        const fr = join(glslDir, `${prog}.frag`); if (existsSync(fr)) bucket.fragment = readFileSync(fr, 'utf8')
      }

      const func = instance.func || name
      registerEffect(func, instance)
      registerEffect(`${namespace}.${func}`, instance)
      registerEffect(`${namespace}/${name}`, instance)
      registerEffect(`${namespace}.${name}`, instance)

      const args = Object.entries(instance.globals || {}).map(([key, spec]) => {
        let enumPath = spec.enum || spec.enumPath
        if (spec.choices && !enumPath) {
          enumPath = `${namespace}.${func}.${key}`
          allChoices[namespace] = allChoices[namespace] || {}
          allChoices[namespace][func] = allChoices[namespace][func] || {}
          allChoices[namespace][func][key] = allChoices[namespace][func][key] || {}
          for (const [nm, val] of Object.entries(spec.choices)) {
            if (typeof nm === 'string' && nm.endsWith(':')) continue
            allChoices[namespace][func][key][nm] = { type: 'Number', value: val }
            const san = sanitizeEnumName ? sanitizeEnumName(nm) : nm
            if (san && san !== nm) allChoices[namespace][func][key][san] = { type: 'Number', value: val }
          }
        }
        return {
          name: key, type: spec.type === 'vec4' ? 'color' : spec.type, default: spec.default,
          enum: enumPath, enumPath, min: spec.min, max: spec.max, uniform: spec.uniform, choices: spec.choices
        }
      })
      if (registerOp) registerOp(`${namespace}.${func}`, { name: func, args })

      const isStarter = !((instance.passes || []).some(p =>
        p.inputs && Object.values(p.inputs).some(v =>
          ['inputTex', 'inputTex3d', 'src', 'o0', 'o1'].includes(v))))
      if (isStarter && registerStarterOps) registerStarterOps([`${namespace}.${func}`])
      if (instance.enums && mergeIntoEnums) await mergeIntoEnums(instance.enums)
    }
  }

  if (mergeIntoEnums && Object.keys(allChoices).length) await mergeIntoEnums(allChoices)
  _booted = { compileGraph }
  return _booted
}

// Runtime graph -> JSON-serializable "fat graph": Map->object, keep program source, drop
// volatile fields (compiledAt) and the allocations Map (the runtime executor ignores it).
function fatten (graph) {
  const textures = {}
  if (graph.textures instanceof Map) { for (const [k, v] of graph.textures) textures[k] = v }
  else Object.assign(textures, graph.textures || {})

  const programs = {}
  for (const [id, p] of Object.entries(graph.programs || {})) {
    programs[id] = {
      glsl: p.glsl,
      vertex: p.vertex,
      fragment: p.fragment,
      source: p.source,
      uniformLayout: p.uniformLayout || {},
      defines: p.defines || {},
      fragmentEntryPoint: p.fragmentEntryPoint
    }
  }

  return {
    id: graph.id,
    source: graph.source,
    renderSurface: graph.renderSurface ?? null,
    passes: graph.passes,
    textures,
    programs
  }
}

export async function exportFatGraph (dsl) {
  const { compileGraph } = await bootstrap()
  const graph = compileGraph(dsl)
  return fatten(graph)
}

async function main () {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    process.stderr.write('usage: node export-fat-graph.mjs "<dsl>" [out.json]\n' +
      '       node export-fat-graph.mjs --file program.dsl [out.json]\n')
    process.exit(2)
  }
  let dsl, outPath
  if (argv[0] === '--file') { dsl = readFileSync(argv[1], 'utf8'); outPath = argv[2] } else { dsl = argv[0]; outPath = argv[1] }

  const fat = await exportFatGraph(dsl)
  const json = JSON.stringify(fat)
  if (outPath) {
    writeFileSync(outPath, json + '\n')
    const nProg = Object.keys(fat.programs).length
    process.stderr.write(`[fat-graph] wrote ${outPath} (${fat.passes.length} passes, ${nProg} programs)\n`)
  } else {
    process.stdout.write(json + '\n')
  }
}

if (basename(process.argv[1] || '') === 'export-fat-graph.mjs') {
  main().catch(err => {
    process.stderr.write(`[fat-graph] FAILED: ${err?.stack || err?.message || JSON.stringify(err)}\n`)
    process.exit(1)
  })
}
