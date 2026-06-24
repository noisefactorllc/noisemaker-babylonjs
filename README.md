# noisemaker-babylon

A [Babylon.js](https://www.babylonjs.com/) port of the Noisemaker procedural shader engine —
the Polymorphic-DSL **compiler**, the render-graph **executor**, and the **effects collection** —
rendering **pixel-identically to the reference WebGL2 engine**.

Sibling to `noisemaker-hlsl` (Unity), `noisemaker-godot`, and `noisemaker-td` (TouchDesigner).

## How it works

Babylon.js is JavaScript driving WebGL2/WebGPU — the exact environment the Noisemaker engine
already targets. So nothing about the shaders or the engine is *translated*. The port runs the
engine **as published** and supplies a single new piece: a **`BabylonBackend`** that satisfies the
engine's `Backend` interface, so the unchanged `Pipeline` runs on `@babylonjs/core`. Effect shaders
are GLSL ES 3.00, used as-is. The engine-agnostic seam is the render graph; here it goes one level
deeper — the backend interface. See [ARCHITECTURE.md](ARCHITECTURE.md).

The engine is **not** vendored into this repo. `vendor/fetch.sh` fetches the published distribution
from `shaders.noisedeck.app` — the engine core ESM (`Pipeline`/`compileGraph`/`WebGL2Backend`) plus
the per-effect "mini-bundles" production pre-fetches — into `vendor/noisemaker/` (gitignored, the
same posture as `node_modules`: the fetch script + loader are committed, never the downloaded bytes).
Run it once before building or testing:

```bash
npm install            # @babylonjs/core (peer) + dev tooling
bash vendor/fetch.sh   # fetch the published engine into vendor/noisemaker/ (gitignored)
```

## Parity

**180 of 184 effects BYTE-IDENTICAL to the reference** (max-abs-diff 0) — the entire catalog except
4 effects that need an external runtime input. That's 149 renderable-2D effects + all 10 agent/points
sims (physarum, life, flock, dla, lenia, …) + the continuous solvers
`reactionDiffusion`/`navierStokes` + the **full 3D-volume raymarch** chain (7 synth3d generators ×
`render3d`/`renderLit3d`, isosurface & voxel, + `flow3d`/`palette3d`) + **single-face cubemaps**
(`renderCubemapSurface`/`renderCubemap3d`) + the **SMRTicles render wrappers** (`pointsEmit`/
`pointsRender`/`pointsBillboardRender`) + the **`loopBegin`/`loopEnd`** accumulator + the points-based
`wormhole` + the **`remap` polygon-zone router** (std140 UBO). Because the candidate renders on the
same WebGL2/ANGLE/Metal driver as the golden, parity is exact — **no effect needs the relaxed
tolerances the Metal-backed Unity/Godot/TD ports required**, and stateful/continuous/agent effects
converge to a bit-identical steady state when evolved ~30s.

**`remap` joined the byte-identical set** (it was mis-filed as external-input): its inputs are engine
surfaces (`zone0_tex: read(o0)`), and it's the **sole** effect whose WebGL2 GLSL declares a
`layout(std140) uniform` block — its 8-zone polygon config (267 vec4 slots) is uploaded as a packed
**UBO**, a path the backend now mirrors from `webgl2.js` byte-for-byte (`extractUniformBlocks` +
`packUniformsWithLayout`). Both the default `remap(bgColor:#336699)` and a non-trivial 2-zone routing
config (`parity/programs/remap_zones.dsl` — a quad + a triangle routing two noise sources over the bg)
are byte-identical. (~31 other effects *declare* a `uniformLayout` but use plain uniforms in WebGL2 —
the layout is WGSL/fallback metadata — so the UBO bind is a no-op for them.)

The 4 effects that are **not** byte-verified all require an external runtime input the headless
harness can't supply deterministically — `media`, `text`, `roll`, and `meshLoader`. They are the only
gaps in the catalog; see **[Not included in this pass](#not-included-in-this-pass)** for the full list
and follow-up notes.

**End-to-end:** the complex emergent test program (3D perlin → 1M-agent flow-field particles
[MRT+points+billboards] → blur → navierStokes ×40 → palette/lighting/adjust/bloom/lens/vignette) is
byte-identical at every 5s sample over 30s. And the **live NoiseBLASTER! corpus** — 19 real shared
compositions fetched from `blaster.noisedeck.app` — is **19/19 byte-identical** (`parity/corpus/`).

The 3D-volume raymarch + cubemaps fell out of the *existing* MRT path with **zero new backend code**
(the "volume" is a 2D atlas the Pipeline sizes to 64×4096, sampled via `texelFetch`). The only two
genuinely-new backend pieces were the mesh `drawMode:'triangles'` raster (depth buffer + back-face
cull + `gl_VertexID` geometry fetch) and the std140 **UBO** upload path for `remap` (the sole effect
with a `layout(std140)` block in WebGL2).

**Cubemap bake.** `NoisemakerRenderer.renderCubemap()` drives the reused `Pipeline.renderCubemap()`
6-face loop and bakes the faces into a **Babylon-native cube texture** (the parallel of the HLSL
port's Unity-native cubemap) — usable directly as a skybox / PBR reflection. **All 6 faces are
byte-identical to the reference** for both `renderCubemapSurface` and `renderCubemap3d`, and
`examples/cubemap.html` renders a live skybox + reflective sphere from a baked noise volume.

> The one load-bearing engine quirk (the kind every cross-engine port hits): the additive particle
> deposit must use raw `blendFunc(ONE, ONE)`; Babylon's `setAlphaMode(ALPHA_ADD)` is `(SRC_ALPHA,
> ONE)`, which crushes the HDR trail accumulation. See PORTING-GUIDE.md.

```bash
npm install && bash vendor/fetch.sh           # deps + fetch the published engine (gitignored)
bash parity/sweep.sh                           # goldens + candidates, both via the vendored engine
```

## Not included in this pass

Four of the 184 catalogued effects (`tools/catalog.mjs`) are **not** byte-verified by this port. Each
needs a runtime input the headless parity harness can't supply deterministically — these are the only
gaps in the catalog; the other **180 are byte-identical**.

| Effect | Namespace | External input it needs |
|---|---|---|
| `media`      | `synth`  | a host-supplied image/video texture |
| `text`       | `filter` | rasterized glyphs (a font / glyph atlas) |
| `roll`       | `synth`  | a MIDI / piano-roll event stream |
| `meshLoader` | `render` | host-side OBJ geometry (vertex / index buffers) |

**Follow-up work**

- **`media`** — upload host media into a surface and sample it. Expected to need **no new backend
  code** (it's a plain texture read), once a deterministic image source is wired into the harness.
- **`text`** — supply a glyph-atlas texture (e.g. rasterized via Canvas2D) as the input surface; it
  then runs as a standard input filter.
- **`roll`** — route host MIDI events into the effect's uniforms / input surface.
- **`meshLoader`** — parse OBJ → populate the mesh surfaces. **The triangle-raster path it feeds is
  already proven byte-identical**: `render/meshRender` (`drawMode:'triangles'`, depth-test +
  back-face cull + `gl_VertexID` geometry fetch, Blinn-Phong-lit) renders at max-abs-diff 0 when
  identical geometry is *injected* into both engines (a sphere). Only the host OBJ-load → mesh-surface
  step is unvetted, and it needs no new raster work — just verification of the parse/upload against
  the reference.
- **Standalone package.** The port consumes the published engine at build/test time via
  `vendor/fetch.sh` (gitignored — the `node_modules` posture). Packaging `noisemaker-babylon` itself
  as a distributable npm module (that fetches the engine on install) is open.

## Usage

```js
import { Engine } from '@babylonjs/core/Engines/engine.js'
// The engine, fetched by vendor/fetch.sh (gitignored). In a browser the core ESM evaluates directly.
import { Pipeline } from './vendor/noisemaker/noisemaker-shaders-core.esm.js'
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

Produce a `fatGraph` from a DSL program (runs the vendored compiler with shader source attached):

```bash
node tools/export-fat-graph.mjs "search synth
noise(seed: 1, scaleX: 30, colorMode: 1, speed: 25).write(o0)
render(o0)" demo.fatgraph.json
```

### Example

```bash
node examples/build.mjs                                   # bundle both demos + generate fat graphs
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
SMRTicles wrappers, the 6-face cubemap bake → Babylon-native cube texture, and the `remap`
polygon-zone router (std140 UBO)** are all done and parity-verified (180/184 byte-identical; all 6
cube faces byte-identical). **Remaining:** the 4 external-input effects (`media`/`text`/`roll`/
`meshLoader`) and packaging as a standalone module — see
[Not included in this pass](#not-included-in-this-pass). Pushed (private). See PORTING-GUIDE.md.

## License

Released under the MIT License (see [LICENSE](LICENSE)). Use of the Noisemaker and Noise Factor names in derivative products is subject to the [Trademark Policy](TRADEMARK.md).

Copyright © 2026 Noise Factor LLC
