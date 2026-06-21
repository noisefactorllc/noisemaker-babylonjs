// renderer.js — NoisemakerRenderer: the consumer-facing host that drives the reference
// Pipeline (via BabylonBackend) and exposes the result as a STABLE Babylon texture any
// material/layer/post-process can sample.
//
// The reference `Pipeline` class is injected (options.Pipeline) rather than hard-imported, so
// this module stays decoupled from the reference repo layout: a host bundles the reference
// runtime (or a vendored copy) and passes the class in. See examples/ for a wired demo.

import { Constants } from '@babylonjs/core/Engines/constants.js'
import { BabylonBackend } from './babylonBackend.js'

// Fat graph (tools/export-fat-graph.mjs) -> the runtime graph shape Pipeline consumes.
export function reconstructGraph (fat) {
  return {
    id: fat.id,
    source: fat.source,
    renderSurface: fat.renderSurface,
    passes: fat.passes,
    programs: fat.programs, // plain object; Pipeline.resolveProgramSpec handles object or Map
    textures: new Map(Object.entries(fat.textures || {})),
    allocations: new Map()
  }
}

export class NoisemakerRenderer {
  /**
   * @param {import('@babylonjs/core').AbstractEngine} engine
   * @param {{ Pipeline: any, size?: number }} options - `Pipeline` is the reference Pipeline class.
   */
  constructor (engine, options = {}) {
    this.engine = engine
    this._Pipeline = options.Pipeline
    this.size = options.size || 256
    this.backend = null
    this.pipeline = null
    this.graph = null
    this._outId = '__nm_output'
    this._outputTexture = null
    this._time = 0
  }

  /** Compile/load a fat graph and prepare the pipeline + a stable output texture. */
  async loadGraph (fatGraph, opts = {}) {
    if (!this._Pipeline) throw new Error('NoisemakerRenderer requires options.Pipeline (the reference Pipeline class).')
    if (opts.size) this.size = opts.size

    this.backend = new BabylonBackend(this.engine)
    this.graph = reconstructGraph(fatGraph)
    this.pipeline = new this._Pipeline(this.graph, this.backend)
    await this.pipeline.init(this.size, this.size)

    // Stable output: passes ping-pong their surfaces every frame, so a material can't hold the
    // raw read buffer. We blit the render surface into a dedicated texture after each frame and
    // hand out that (constant) texture instead.
    this.backend.createTexture(this._outId, {
      width: this.size, height: this.size, format: 'rgba16f', usage: ['render', 'sample']
    })
    this._outputTexture = this.backend.textures.get(this._outId).thin
    return this
  }

  /** Render one frame at a normalized 0..1 time and refresh the stable output texture. */
  renderFrame (normalizedTime) {
    if (!this.pipeline) return
    this._time = normalizedTime ?? this._time
    this.pipeline.render(this._time)
    const id = this._resolveRenderSurfaceId()
    if (id) this.backend.copyTexture(id, this._outId)
  }

  _resolveRenderSurfaceId () {
    const name = this.graph.renderSurface
    if (!name) return null
    const surf = this.pipeline.surfaces.get(name) ||
      this.pipeline.surfaces.get(String(name).replace(/^global_/, ''))
    return this.pipeline.frameReadTextures.get(name) ?? surf?.read ?? null
  }

  /** A stable Babylon ThinTexture of the latest rendered frame (for EffectWrapper/PostProcess). */
  get outputTexture () { return this._outputTexture }

  /** The raw InternalTexture of the stable output — wrap in a scene `Texture` for StandardMaterial:
   *    const t = new Texture(null, scene); t._texture = nm.outputInternalTexture;  mat.diffuseTexture = t; */
  get outputInternalTexture () { return this.backend?.textures.get(this._outId)?.internal ?? null }

  /** Inject/override a DSL/effect uniform at runtime (oscillators, params, …). */
  setUniform (name, value) { this.pipeline?.setUniform?.(name, value) }

  /** Resize the render + output to a new square size. */
  resize (size) {
    this.size = size
    this.pipeline?.resize?.(size, size)
    this.backend?.destroyTexture?.(this._outId)
    this.backend?.createTexture?.(this._outId, { width: size, height: size, format: 'rgba16f', usage: ['render', 'sample'] })
    this._outputTexture = this.backend?.textures.get(this._outId)?.thin ?? null
  }

  /** Read the current output as top-down linear 8-bit RGBA (parity/export use). */
  async readPixels () { return this.backend.readPixels(this._outId) }

  /**
   * Bake the loaded composition into a cubemap. The graph must end in a cubemap renderer
   * (`renderCubemapSurface`/`renderCubemap3d`) writing to `outputSurface`. Drives the reused
   * `Pipeline.renderCubemap()` (6-face loop: per face it sets the `cubeBasis` camera basis,
   * renders, and reads back the surface), then bakes the faces into a **Babylon-native cube
   * `InternalTexture`** — the parallel of the HLSL port's Unity-native cubemap. Where the reference
   * hands back 6 CPU buffers, here you also get a GPU cube texture ready for a skybox / PBR
   * reflection. Each backend renders its own faces, so this is byte-identical to the reference
   * (verified in parity/cubemap-bake-check.mjs).
   *
   * @returns {Promise<{ faces: Array<{width:number,height:number,data:Uint8Array}>, cubeTexture: import('@babylonjs/core').InternalTexture }>}
   *   faces in GL order (+X,-X,+Y,-Y,+Z,-Z), RGBA8 top-down; cubeTexture wraps them on the GPU.
   */
  async renderCubemap (opts = {}) {
    if (!this.pipeline?.renderCubemap) throw new Error('NoisemakerRenderer.renderCubemap: the injected Pipeline has no renderCubemap() (update the reference engine).')
    const size = opts.size || this.size
    const outputSurface = opts.outputSurface || this.graph?.renderSurface || 'o0'
    const time = opts.time ?? this._time
    const faces = await this.pipeline.renderCubemap({ size, outputSurface, time })
    // Babylon's cube face order is +X,-X,+Y,-Y,+Z,-Z — identical to the reference, so the 6 buffers
    // drop straight in. invertY:false (readPixels already delivered top-down image rows).
    const data = faces.map(f => (f.data instanceof Uint8Array ? f.data : Uint8Array.from(f.data)))
    const cube = this.engine.createRawCubeTexture(
      data, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE,
      false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, null
    )
    if (this._cubeInternal && this._cubeInternal !== cube) { try { this._cubeInternal.dispose?.() } catch { /* noop */ } }
    this._cubeInternal = cube
    return { faces, cubeTexture: cube }
  }

  /** The raw cube `InternalTexture` from the last renderCubemap() — wrap in a scene `CubeTexture`:
   *    const ct = new CubeTexture('', scene); ct._texture = nm.cubeInternalTexture; scene.reflectionTexture = ct; */
  get cubeInternalTexture () { return this._cubeInternal ?? null }

  dispose () {
    try { this._cubeInternal?.dispose?.() } catch { /* noop */ }
    try { this.backend?.destroy?.() } catch { /* noop */ }
    this.pipeline = null
    this.backend = null
    this._outputTexture = null
    this._cubeInternal = null
  }
}

export default NoisemakerRenderer
