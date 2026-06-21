// hero-present.js — render a DSL program on a Babylon canvas, evolved to its 30-second state,
// for a side-by-side (DSL + canvas) screenshot. Bundled to an IIFE by hero-shot.mjs.
import { Engine } from '@babylonjs/core/Engines/engine.js'
import '@babylonjs/core/Shaders/postprocess.vertex.js'
import { Pipeline } from '../vendor/noisemaker/noisemaker-shaders-core.esm.js'
import { BabylonBackend } from '../src/runtime/babylonBackend.js'

function reconstruct (fat) {
  return {
    id: fat.id, source: fat.source, renderSurface: fat.renderSurface,
    passes: fat.passes, programs: fat.programs,
    textures: new Map(Object.entries(fat.textures || {})), allocations: new Map()
  }
}

window.runHero = async function (fat, opts = {}) {
  try { await _runHero(fat, opts) } catch (e) { window.__heroError = String((e && e.stack) || e) }
}

async function _runHero (fat, opts = {}) {
  const size = opts.size || 512
  const frames = opts.frames || 1800
  const ts = opts.timestep ?? (1 / 600) // the demo's natural per-frame rate
  const time = opts.time ?? 0.25

  // Babylon owns the WebGL2 context; the pipeline renders to its offscreen targets.
  const rcanvas = document.createElement('canvas')
  rcanvas.width = size; rcanvas.height = size
  const engine = new Engine(rcanvas, false,
    { preserveDrawingBuffer: true, alpha: false, antialias: false, powerPreference: 'high-performance' }, false)
  const backend = new BabylonBackend(engine)
  const graph = reconstruct(fat)
  const pipeline = new Pipeline(graph, backend)
  await pipeline.init(size, size)

  const view = document.getElementById('view')
  view.width = size; view.height = size
  const ctx = view.getContext('2d')
  const status = document.getElementById('status')

  // Present the current render surface (read as top-down RGBA) onto the visible canvas.
  const present = async () => {
    const name = graph.renderSurface
    const surf = pipeline.surfaces.get(name) || pipeline.surfaces.get(String(name).replace(/^global_/, ''))
    let readId = pipeline.frameReadTextures.get(name)
    if (!readId && surf) readId = surf.read
    if (!readId) return
    const px = await backend.readPixels(readId)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0)
  }

  for (let i = 0; i < frames; i++) {
    pipeline.render(ts > 0 ? (time + i * ts) % 1 : time)
    if (i % 60 === 0) { // ~once per "second" — yield via setTimeout (rAF is paused in headless)
      status.textContent = `evolving — ${(i / 60) | 0}s / ${(frames / 60) | 0}s   (frame ${i}/${frames})`
      await present()
      await new Promise(r => setTimeout(r, 0))
    }
  }
  await present()
  status.textContent = `30 s steady state — ${frames} frames @ ${size}×${size} · Babylon.js / BabylonBackend`
  window.__heroDone = true
}
