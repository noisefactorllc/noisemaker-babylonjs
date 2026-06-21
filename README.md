# noisemaker-babylon

A [Babylon.js](https://www.babylonjs.com/) port of the Noisemaker procedural shader engine —
the Polymorphic-DSL **compiler**, the render-graph **executor**, and the **effects collection** —
rendering **pixel-identically to the reference WebGL2 engine** (`../noisemaker`).

Sibling to `noisemaker-hlsl` (Unity), `noisemaker-godot`, and `noisemaker-td` (TouchDesigner).

## How it works

Babylon.js is JavaScript driving WebGL2/WebGPU — the exact environment the reference engine
already targets. So instead of re-implementing the engine, this port **reuses the reference DSL
compiler + render Pipeline verbatim** and supplies a single new piece: a **`BabylonBackend`** that
satisfies the reference `Backend` interface, so the unchanged `Pipeline` runs on `@babylonjs/core`.
Effect shaders are reused **verbatim** (reference GLSL ES 3.00). The engine-agnostic seam is the
render graph; here it goes one level deeper — the backend interface. See
[ARCHITECTURE.md](ARCHITECTURE.md).

## Parity

**179 of 184 effects BYTE-IDENTICAL to the reference** (max-abs-diff 0) — the entire catalog except
5 effects that need an external runtime input. That's 149 renderable-2D effects + all 10 agent/points
sims (physarum, life, flock, dla, lenia, …) + the continuous solvers
`reactionDiffusion`/`navierStokes` + the **full 3D-volume raymarch** chain (7 synth3d generators ×
`render3d`/`renderLit3d`, isosurface & voxel, + `flow3d`/`palette3d`) + **single-face cubemaps**
(`renderCubemapSurface`/`renderCubemap3d`) + the **SMRTicles render wrappers** (`pointsEmit`/
`pointsRender`/`pointsBillboardRender`) + the **`loopBegin`/`loopEnd`** accumulator + the points-based
`wormhole`. Because the candidate renders on the same WebGL2/ANGLE/Metal driver as the golden, parity
is exact — **no effect needs the relaxed tolerances the Metal-backed Unity/Godot/TD ports required**,
and stateful/continuous/agent effects converge to a bit-identical steady state when evolved ~30s.

The only 5 non-byte-identical effects all require an external source the headless harness can't supply:
**media** (texture), **text** (glyphs), **remap** (projection), **roll** (MIDI), and **meshLoader**
(OBJ geometry) — and even the mesh raster `meshRender` feeds from is **proven byte-identical** by
injecting identical geometry into both engines (`parity/mesh-raster-check.mjs` — a depth-tested,
back-face-culled, Blinn-Phong-lit sphere, max-abs-diff 0).

**End-to-end:** the complex emergent test program (3D perlin → 1M-agent flow-field particles
[MRT+points+billboards] → blur → navierStokes ×40 → palette/lighting/adjust/bloom/lens/vignette) is
byte-identical at every 5s sample over 30s. And the **live NoiseBLASTER! corpus** — 19 real shared
compositions fetched from `blaster.noisedeck.app` — is **19/19 byte-identical** (`parity/corpus/`).

The 3D-volume raymarch + cubemaps fell out of the *existing* MRT path with **zero new backend code**
(the "volume" is a 2D atlas the Pipeline sizes to 64×4096, sampled via `texelFetch`). The only new
backend code was the mesh `drawMode:'triangles'` raster (depth buffer + back-face cull + `gl_VertexID`
geometry fetch).

**Cubemap bake.** `NoisemakerRenderer.renderCubemap()` drives the reused `Pipeline.renderCubemap()`
6-face loop and bakes the faces into a **Babylon-native cube texture** (the parallel of the HLSL
port's Unity-native cubemap) — usable directly as a skybox / PBR reflection. **All 6 faces are
byte-identical to the reference** for both `renderCubemapSurface` and `renderCubemap3d`
(`parity/cubemap-bake-check.mjs`), and `examples/cubemap.html` renders a live skybox + reflective
sphere from a baked noise volume.

> The one load-bearing engine quirk (the kind every cross-engine port hits): the additive particle
> deposit must use raw `blendFunc(ONE, ONE)`; Babylon's `setAlphaMode(ALPHA_ADD)` is `(SRC_ALPHA,
> ONE)`, which crushes the HDR trail accumulation. See PORTING-GUIDE.md.

```bash
npm install                                   # @babylonjs/core + dev tooling
NM_REFERENCE_ROOT=../noisemaker bash parity/sweep.sh
```

## Usage

```js
import { Engine } from '@babylonjs/core/Engines/engine.js'
import { Pipeline } from '../noisemaker/shaders/src/runtime/pipeline.js' // the reference engine
import { NoisemakerRenderer } from 'noisemaker-babylon'

const engine = new Engine(canvas, true)
const nm = new NoisemakerRenderer(engine, { Pipeline, size: 512 })
await nm.loadGraph(fatGraph)                  // fatGraph from tools/export-fat-graph.mjs

// Use the live output as a texture on any material:
const tex = new Texture(null, scene)
tex._texture = nm.outputInternalTexture
material.diffuseTexture = tex

engine.runRenderLoop(() => { nm.renderFrame(t); scene.render() }) // t normalized 0..1
```

Produce a `fatGraph` from a DSL program (runs the reference compiler with shader source attached):

```bash
node tools/export-fat-graph.mjs "search synth
noise(seed: 1, scaleX: 30, colorMode: 1, speed: 25).write(o0)
render(o0)" demo.fatgraph.json
```

### Example

```bash
NM_REFERENCE_ROOT=../noisemaker node examples/build.mjs   # bundle both demos + generate fat graphs
# open examples/index.html    (a Noisemaker effect as a live texture on a spinning box)
# open examples/cubemap.html  (a baked Noisemaker cubemap as a skybox + reflective sphere)
node examples/verify.mjs                                  # headless render check (procedural texture)
node examples/verify-cubemap.mjs                          # headless render check (baked skybox)
```

## Layout

```
src/runtime/babylonBackend.js   the Backend impl on @babylonjs/core (the one new component)
src/runtime/renderer.js         NoisemakerRenderer host (stable output texture for materials)
tools/export-fat-graph.mjs      DSL → runnable fat graph (reference compiler + GLSL attached)
parity/                         run.sh / sweep.sh / compare.py + reused goldens + corpus
reference/01–10                 engine-agnostic re-implementer specs (shared with sibling ports)
examples/                       a Babylon scene using a noisemaker effect as a texture
docs/IMPLEMENTATION-PLAN.md     the phased build plan
```

## Status

Single-output render, multi-pass (e.g. blur H/V), input filters, 2-/3-input mixers, blit, blend,
half-float, readback, **MRT, `drawMode:points|billboards` agent deposits, 3D-volume raymarch,
single-face cubemaps, the `meshRender` triangle raster (depth+cull), `loopBegin`/`loopEnd`, and the
SMRTicles wrappers, and the 6-face cubemap bake → Babylon-native cube texture** are all done and
parity-verified (179/184 byte-identical; all 6 cube faces byte-identical). **Remaining:** host-side
OBJ loading for `meshLoader` (external geometry, like `media`'s external texture) and vendoring the
reference engine for a standalone published package. Local-only; not pushed. See PORTING-GUIDE.md.

## License

MIT (matching the reference). Noisemaker is a trademark of Noise Factor LLC.
