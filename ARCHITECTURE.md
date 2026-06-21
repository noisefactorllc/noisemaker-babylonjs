# noisemaker-babylon — Architecture

A Babylon.js port of the Noisemaker procedural shader engine (`../noisemaker/shaders`): DSL
compiler, render-graph executor, and effects collection, **pixel-identical to the reference
WebGL2 engine**. Sibling to `noisemaker-hlsl` (Unity), `noisemaker-godot`, `noisemaker-td`.

## The seam: deeper than the foreign-language ports

The Unity/Godot/TouchDesigner ports re-implement the render-graph executor in a foreign
language, taking on parity risk in the pipeline logic (texture pool, three-tier ping-pong,
surface-swap predicates, uniform packing, frame loop).

**Babylon.js is JavaScript driving WebGL2/WebGPU — the exact reference environment.** The
reference `Pipeline` (`shaders/src/runtime/pipeline.js`) is `new Pipeline(graph, backend)` and
drives a *swappable* `backend` (the abstract `Backend` in `shaders/src/runtime/backend.js`;
concrete `WebGL2Backend`/`WebGPUBackend` are injected by the host). So the seam is pushed one
level deeper than the render-graph JSON — to the **backend interface**:

```
            reference JS (reused verbatim)                       new code
   ┌────────────────────────────────────────────────┐   ┌────────────────────────┐
   DSL ─► lex/parse/validate/expand ─► compileGraph ─► Pipeline ──drives──► BabylonBackend
          (lang/, runtime/expander)    (runtime/         (runtime/            (@babylonjs/core)
                                        compiler.js)      pipeline.js)
   └────────────────────────────────────────────────┘   └────────────────────────┘
                                                              exposes ► NoisemakerRenderer
                                                                        (stable Babylon texture)
```

We reuse the **compiler + expander + pipeline** (every parity-critical thing) unchanged, and
implement **one new component**: `BabylonBackend`, satisfying the `Backend` interface on
Babylon's GPU abstractions. Effect shaders are reused **verbatim** — Babylon's WebGL2 path is
GLSL ES 3.00 with the same `gl_FragCoord` bottom-left origin as the reference. This collapses the
golden/live producer distinction (both are literally the reference compiler) and removes nearly
all pipeline parity risk. The only parity surfaces are (a) `BabylonBackend` matching `webgl2.js`'s
GPU operations and (b) Babylon not mangling the reused GLSL (see PORTING-GUIDE.md).

## Components

- **`src/runtime/babylonBackend.js`** — the `Backend` impl. Mirrors `webgl2.js` exactly,
  translated to Babylon:
  | reference `webgl2.js` | Babylon |
  |---|---|
  | `createTexture` (NEAREST/CLAMP, FBO if `usage∋render`) | `engine.createRenderTargetTexture` (HALF_FLOAT/RGBA, `TEXTURE_NEAREST_SAMPLINGMODE`, `TEXTURE_CLAMP_ADDRESSMODE`) |
  | `compileProgram` (`injectDefines` + fullscreen VS) | `EffectWrapper` (raw GLSL, custom fullscreen VS, `defines`) |
  | `executePass` (FBO bind, viewport, samplers, uniforms, blend, draw) | `EffectRenderer.render(wrapper, rtw)` + `onApplyObservable` uniform/texture binding |
  | `bindUniforms` (pass then globals, by GL type) | `effect.setFloat/Int/Bool/Float2/3/4` by parsed uniform type |
  | blit (`v_texCoord` copy) | `gl_FragCoord`/`texelFetch` copy wrapper |
  | `present` (Y at canvas) | (offscreen parity reads surfaces directly) |
  | `readPixels` (float→`round(v*255)`, flip to top-down) | `engine._readTexturePixels` (Float32) → same quantize + flip |
  - All 2D textures NEAREST/CLAMP (surfaces are sampled NEAREST — load-bearing for warp effects).
  - Engine/system uniforms fed by name every pass: `resolution`, `time` (normalized 0..1, 10s
    loop), `tileOffset=[0,0]`, `fullResolution`, `aspectRatio`, `renderScale=1`, etc.
  - MRT / `drawMode:points|billboards` / 3D volumes / mesh-triangle passes are **staged** (warn +
    skip) — none appear in the Tier-1 2D corpus.

- **`src/runtime/renderer.js`** — `NoisemakerRenderer`, the consumer host. Takes a Babylon engine
  + the reference `Pipeline` class (injected), `loadGraph(fatGraph)`, `renderFrame(t)`, and
  exposes a **stable** output texture (`outputTexture` / `outputInternalTexture`) — the render
  surface is blitted into a dedicated texture each frame so a material can hold one reference.

- **`tools/export-fat-graph.mjs`** — Node producer. Runs the unchanged reference `compileGraph`
  with each program's GLSL attached (filesystem edition of `canvas.js loadEffectShaders`), and
  serializes the runnable runtime graph (passes + programs-with-source + textures + renderSurface)
  as a "fat graph". (The normalized golden `graph.json` from `tools/export-graph.mjs` is
  structure-only — it drops shader source and effect program entries — so it is NOT runnable.)

- **`reference/01–10`** — the engine-agnostic re-implementer specs, reused verbatim from the
  sibling ports.

## Validation (`parity/`)

Goldens are reused from `../noisemaker-godot` (same DSL × same reference WebGL2 renderer ⇒
byte-identical). The Babylon candidate renders the reused reference `Pipeline` + `BabylonBackend`
in **headless Chromium on ANGLE/Metal — the same WebGL2 driver the golden was rendered on** (a
real GPU; `NullEngine` does no GPU work). `parity/compare.py` grades max-abs-diff + SSIM.

**Result: 149 / 152 renderable-2D effects pass at the strict default (max-diff ≤ 2.001), zero
needing the relaxed tolerances the Metal-backed godot/td ports required** — because candidate and
golden share the WebGL2/ANGLE/Metal driver, parity is byte-tight (most effects max-diff 0). This
**includes the continuous solvers `reactionDiffusion` + `navierStokes`**, which every Metal-backed
sibling port documents as cross-backend-divergent skips but which pixel-parity BYTE-IDENTICALLY
here when evolved ~30s to a deterministic steady-state attractor (the `EVOLVE` map in
`render-batch.mjs`). The 3 skips are external-input effects (media/text/remap need MIDI/glyph/
projection sources). Beyond 2D, the **10 points/agent sims** (physarum, life, flock, …) render
correctly via the MRT + points-deposit executor (162 programs render, 0 errors) but are
render-verified-only: their points-deposit additive float blend is fp-order-sensitive and their
chaotic trajectories amplify it (unlike the field solvers, which converge bit-exact).

## Status & staged work

- DONE: compiler + pipeline reuse, `BabylonBackend` (single-output render, multi-pass, filters,
  2-/3-input mixers, blit, blend, uniforms, half-float, readback), `NoisemakerRenderer`, the
  87-program parity sweep, a Babylon example scene.
- STAGED: MRT + `drawMode:points` agent effects, 3D volumes/raymarch/meshes, the WebGPU path
  (same shaders via Babylon's GLSL→WGSL), and vendoring the reference engine for a standalone
  published package (today the parity harness + example import the sibling reference by path).

Local-only; **not pushed**. Commits omit the `Co-Authored-By` trailer.
