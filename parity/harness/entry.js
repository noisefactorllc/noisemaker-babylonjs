// Babylon parity-harness entry (bundled to an IIFE by render-candidate.mjs).
//
// Runs the UNCHANGED reference `Pipeline` with the new `BabylonBackend` injected, in a real
// headless-Chromium WebGL2 context (NullEngine can't render). Exposes window.nmRunFatGraph,
// which a Playwright driver calls with a fat graph (from tools/export-fat-graph.mjs).

import { Engine } from '@babylonjs/core/Engines/engine.js'
import '@babylonjs/core/Shaders/postprocess.vertex.js' // register EffectRenderer's default vertex
import { Pipeline } from '../../../noisemaker/shaders/src/runtime/pipeline.js'
import { BabylonBackend } from '../../src/runtime/babylonBackend.js'
import { NoisemakerRenderer } from '../../src/runtime/renderer.js'

function reconstruct (fat) {
  return {
    id: fat.id,
    source: fat.source,
    renderSurface: fat.renderSurface,
    passes: fat.passes,
    programs: fat.programs, // plain object: resolveProgramSpec handles object or Map
    textures: new Map(Object.entries(fat.textures || {})),
    allocations: new Map()
  }
}

window.nmRunFatGraph = async function (fat, opts = {}) {
  const size = opts.size || 256
  const time = (opts.time ?? 0.25)
  const frames = opts.frames || 8

  // Fresh canvas per run (a canvas owns one WebGL2 context) so a single page can render many
  // programs in sequence; disposed at the end to free the context for the next program.
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  document.body.appendChild(canvas)

  const engine = new Engine(canvas, false, {
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    alpha: false,
    stencil: false,
    antialias: false,
    powerPreference: 'high-performance'
  }, false)

  const backend = new BabylonBackend(engine)
  const graph = reconstruct(fat)
  const pipeline = new Pipeline(graph, backend)

  await pipeline.init(size, size)
  // Pinned time (ts=0): feedback/state surfaces settle (8-frame default). ts>0 ADVANCES time
  // per frame (tt=(t+i*ts)%1) — matches the golden harness's --timestep, used to evolve
  // continuous solvers (navierStokes/reactionDiffusion) over ~30s for a steady-state compare.
  const ts = opts.timestep || 0
  for (let i = 0; i < frames; i++) pipeline.render(ts > 0 ? (time + i * ts) % 1 : time)

  // Resolve the render surface's current read texture (mirrors Pipeline's present step).
  const name = graph.renderSurface
  const surf = pipeline.surfaces.get(name) || pipeline.surfaces.get(String(name).replace(/^global_/, ''))
  let readId = pipeline.frameReadTextures.get(name)
  if (!readId && surf) readId = surf.read
  if (!readId) throw new Error('nmRunFatGraph: render surface not found: ' + name)

  const px = await backend.readPixels(readId)
  const out = { width: px.width, height: px.height, data: Array.from(px.data), readId, renderSurface: name }

  if (opts.debug) {
    const caps = engine.getCaps ? engine.getCaps() : {}
    const dbg = {
      readId,
      renderSurface: name,
      caps: { blendFloat: caps.blendFloat, colorBufferFloat: caps.colorBufferFloat, textureFloat: caps.textureFloat, textureHalfFloat: caps.textureHalfFloat, textureFloatLinearFiltering: caps.textureFloatLinearFiltering, textureHalfFloatLinearFiltering: caps.textureHalfFloatLinearFiltering },
      surfaces: {},
      textures: [],
      programs: [...backend.programs.keys()]
    }
    for (const [sname, surf] of pipeline.surfaces) dbg.surfaces[sname] = { read: surf.read, write: surf.write }
    for (const [id, rec] of backend.textures) {
      try {
        const p = await backend.readPixels(id)
        let max = 0; let nz = 0
        for (let i = 0; i < p.data.length; i++) { if (p.data[i] > max) max = p.data[i]; if (p.data[i] !== 0) nz++ }
        const ci = ((p.height >> 1) * p.width + (p.width >> 1)) * 4
        dbg.textures.push({ id, w: p.width, h: p.height, max, nzFrac: +(nz / p.data.length).toFixed(3), center: Array.from(p.data.slice(ci, ci + 4)) })
      } catch (e) { dbg.textures.push({ id, error: String(e) }) }
    }
    out.debug = dbg
  }

  try { engine.dispose() } catch { /* noop */ }
  try { canvas.remove() } catch { /* noop */ }
  return out
}

// Same render, but driven through the consumer-facing NoisemakerRenderer host (loadGraph →
// renderFrame → stable output texture → readPixels). Proves the integration surface is itself
// pixel-parity, not just the raw backend path.
window.nmRunViaRenderer = async function (fat, opts = {}) {
  const size = opts.size || 256
  const time = (opts.time ?? 0.25)
  const frames = opts.frames || 8
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  document.body.appendChild(canvas)
  const engine = new Engine(canvas, false, { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, stencil: false }, false)
  const nm = new NoisemakerRenderer(engine, { Pipeline, size })
  await nm.loadGraph(fat)
  for (let i = 0; i < frames; i++) nm.renderFrame(time)
  const px = await nm.readPixels()
  const out = { width: px.width, height: px.height, data: Array.from(px.data) }
  try { nm.dispose(); engine.dispose(); canvas.remove() } catch { /* noop */ }
  return out
}

window.nmReady = true
