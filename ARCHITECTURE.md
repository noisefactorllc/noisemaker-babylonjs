# Noisemaker for Babylon.js — Architecture

A Babylon.js port of the Noisemaker procedural shader engine: DSL compiler, render-graph executor,
and effects collection, **pixel-identical to the reference WebGL2 engine**. The engine is the
**published distribution** (`shaders.noisedeck.app`), fetched by `vendor/fetch.sh` into
`vendor/noisemaker/` (gitignored — never committed). Sibling to `noisemaker-for-unity` (Unity),
`noisemaker-for-godot`, `noisemaker-for-touchdesigner`.

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
         published engine (fetched, run as-is)                  new code
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
  | `extractUniformBlocks`/`bindUniformBlocks`/`packUniformsWithLayout` (std140 UBO) | raw-GL UBO (`createBuffer`/`uniformBlockBinding`/`bufferSubData`/`bindBufferBase`), same std140 packing — `remap` only |
  | `uploadDataTexture` (raw CPU->GPU data upload) | `createTexture` (or resize) + raw `texSubImage2D` on the underlying GL texture — `roll`'s MIDI note-grid only |
  | `present` (Y at canvas) | (offscreen parity reads surfaces directly) |
  | `readPixels` (float→`round(v*255)`, flip to top-down) | `engine._readTexturePixels` (Float32) → same quantize + flip |
  - All 2D textures NEAREST/CLAMP (surfaces are sampled NEAREST — load-bearing for warp effects).
  - Engine/system uniforms fed by name every pass: `resolution`, `time` (normalized 0..1, 10s
    loop), `tileOffset=[0,0]`, `fullResolution`, `aspectRatio`, `renderScale=1`, etc.
  - MRT, `drawMode:points|billboards` (agent deposit), 3D-volume raymarch (2D-atlas MRT passes),
    single-face AND 6-face-baked cubemaps, the `drawMode:triangles` mesh raster, and the std140
    **UBO** upload path (`remap`'s 267-vec4 polygon-zone config) are all **implemented +
    parity-verified**. Only host OBJ loading for `meshLoader` remains (not yet vetted).

- **`src/runtime/renderer.js`** — `NoisemakerRenderer`, the consumer host. Takes a Babylon engine
  + the reference `Pipeline` class (injected), `loadGraph(fatGraph)`, `renderFrame(t)`, and
  exposes a **stable** output texture (`outputTexture` / `outputInternalTexture`) — the render
  surface is blitted into a dedicated texture each frame so a material can hold one reference.
  Also `renderCubemap({size, outputSurface, time})` — bakes a cubemap composition into 6 faces (via
  the reused `Pipeline.renderCubemap()`) AND a **Babylon-native cube `InternalTexture`**
  (`cubeInternalTexture`) for skyboxes / PBR reflections.

- **`vendor/fetch.sh` + `vendor/engine.mjs`** — fetch the published engine
  (`shaders.noisedeck.app`) into `vendor/noisemaker/` (gitignored) and load it in Node. The fetch
  pulls the engine core ESM + the per-effect "mini-bundles" production pre-fetches (each carries its
  GLSL inline). `engine.mjs` evaluates the bundle behind a tiny DOM shim and registers every effect.

- **`tools/export-fat-graph.mjs`** — Node producer. Boots the vendored engine and runs its
  `compileGraph` (each mini-bundle's GLSL is already inline), serializing the runnable runtime graph
  (passes + programs-with-source + textures + renderSurface) as a "fat graph" the harness reconstructs.

- **`reference/01–10`** — the engine-agnostic re-implementer specs, shared across the port family.

## Validation (`parity/`)

Goldens are minted by the **vendored engine's `WebGL2Backend`** (`NM_GOLDEN=1`) — the *same* published
engine the Babylon candidate runs, only the backend differs (the purest possible parity test: it
isolates `BabylonBackend` vs `WebGL2Backend`). Both render in **headless Chromium on ANGLE/Metal — one
WebGL2 driver** (a
real GPU; `NullEngine` does no GPU work). `parity/compare.py` grades max-abs-diff + SSIM.

**Result: 206 of 210 effects BYTE-IDENTICAL to the reference** (max-diff 0) — the entire catalog
except 4 external-input effects (three of those four are themselves byte-identical on their no-input
fallback path — see STATUS.md). That's 179 renderable-2D effects (including all 25 of the 2026-07
artistic-filter release: `chrome`, `strokes`, `hatch`, `texture`'s new modes, …) + all 10 agent/points
sims + `reactionDiffusion`/`navierStokes` + the **full 3D-volume raymarch** (7 synth3d generators ×
`render3d`/`renderLit3d` × isosurface/voxel + `flow3d`/`palette3d`) + **single-face cubemaps**
(`renderCubemapSurface`/`renderCubemap3d`) + the **SMRTicles wrappers** (`pointsEmit`/`pointsRender`/
`pointsBillboardRender`) + **`loopBegin`/`loopEnd`** + points-based `wormhole` + the **`remap`
polygon-zone router** (std140 UBO — see below). Because candidate and golden share the
WebGL2/ANGLE/Metal driver, parity is exact — **zero effects need relaxed tolerances** (the
per-effect safety-net map `parity/sweep.sh` used to carry for `newton`/`shadow`/`uvRemap`/
`distortion`/`edge`/`pinch`/`crt` was retired this round once a full re-grade proved all of them
byte-exact too), and the stateful/continuous/agent effects (including `reactionDiffusion`) converge
to a bit-identical steady state when evolved ~30s (the `EVOLVE` map in `render-batch.mjs`). The 4
non-byte-identical effects all require an external source the headless harness can't supply:
**media** (texture), **text** (glyphs), **roll** (MIDI), **meshLoader** (OBJ — not yet vetted).

**Beyond defaults: every mode of every artistic filter.** 101 (effect, mode) fixtures across 19
effects — every enum/define-selected mode of `texture` (15), `hatch` (6), `morphology`
(dilate/erode × square/round), etc., not just each effect's default configuration — are individually
fixtured, minted, and graded, all byte-identical. See STATUS.md's "Mode coverage" section and
`parity/mode-coverage.json`.

**`remap` was mis-filed as external-input.** Its inputs are engine surfaces (`zoneN_tex: read(oN)`),
not external data — the only "external" part is the 8-zone polygon config the Remap web app produces,
which fills *uniforms*. It's the **sole** effect whose WebGL2 GLSL declares a `layout(std140) uniform`
block (`vec4 data[267]`), uploaded as a packed **UBO**. The backend now mirrors `webgl2.js`'s UBO path
(`extractUniformBlocks` + `bindUniformBlocks` + `packUniformsWithLayout`) on the raw GL context —
lazily extracting the block on first draw (the program is current, so `ACTIVE_UNIFORM_BLOCKS` is
queryable) and packing the merged uniforms into the std140 byte layout. Both the default
`remap(bgColor:#336699)` and a non-trivial 2-zone routing config (`parity/programs/remap_zones.dsl`,
golden minted via the reference WebGL2 harness) are byte-identical. ~31 other effects *declare* a
`uniformLayout` but use plain uniforms in WebGL2 (the layout is WGSL/fallback metadata) → no block →
the UBO bind is a no-op for them (verified: noise/cell/julia/gabor/mandelbrot/mashup/… unchanged).

**The 3D-volume + cubemap chain needed ZERO new backend code.** The "3D volume" is a 2D *atlas*
(64×4096 = 64 slices of 64²) the Pipeline sizes and allocates via the normal `createTexture` path;
shaders read it with `texelFetch(volumeCache, ivec2(x, y + z·volSize))`. The synth3d precompute and
the `render3d`/`renderLit3d`/cubemap raymarch are all fullscreen `drawBuffers:2` MRT passes the
existing `_executeMRT` already runs. No real GPU 3D texture is used anywhere (`createTexture3D`
stays a guard). The only three genuinely-new backend pieces were the mesh `drawMode:'triangles'` raster
(`_executeTriangles`: a `DEPTH_COMPONENT24` renderbuffer + depth test + back-face cull + `gl_VertexID`
geometry fetch from an empty VAO, plus a `_chain_\d+$` strip in input/count resolution so chain-scoped
mesh refs find the unscoped surface — mirrors `webgl2.bindTextures`), the std140 **UBO** path
(`_bindUniformBlocks`/`_extractUniformBlocks`/`_packUniformsWithLayout`) for `remap`, and (this round)
`uploadDataTexture` for `roll`'s MIDI note-grid.

**End-to-end validation.** The complex emergent test program (3D perlin → 1M-agent flow-field
particles [MRT+points+billboards] → blur → navierStokes ×40 → palette/lighting/adjust/bloom/lens/
vignette) is byte-identical at every 5s sample over 30s. The **live NoiseBLASTER! corpus** —
real shared compositions fetched from `blaster.noisedeck.app` (`parity/corpus/`) — matches the
reference; see STATUS.md for the current pass count. The **mesh triangle raster** was proven byte-identical by injecting an
identical procedural sphere into both engines' mesh textures — a depth-tested, back-face-culled,
Blinn-Phong-lit sphere, max-abs-diff 0. The one load-bearing fix
that unlocked the agent sims + corpus was the additive deposit blend: raw `blendFunc(ONE,ONE)`, not
Babylon's `ALPHA_ADD` (= `SRC_ALPHA, ONE`, which crushes HDR trail accumulation) — see PORTING-GUIDE.md.

## Status & staged work

- DONE: compiler + pipeline reuse; `BabylonBackend` (fullscreen render, multi-pass, filters,
  2-/3-input mixers, blit, blend, uniforms, half-float, readback, **MRT, points/billboards-deposit
  agent sims, 3D-volume raymarch, `meshRender` triangle raster, `loopBegin`/`loopEnd`, SMRTicles
  wrappers, std140 UBO (`remap`), `uploadDataTexture` (`roll`)**); `NoisemakerRenderer` (+
  `renderCubemap()` → 6-face bake to a Babylon cube texture); the parity sweep (206/210
  byte-identical, 101/101 mode-matrix fixtures byte-identical) + the live-corpus + mesh-raster +
  cubemap-bake harnesses; two Babylon example scenes (procedural texture, baked-cubemap skybox). The
  test target + live corpus + all 6 cube faces byte-identical.
- STAGED: host-side OBJ loading for `meshLoader` (external geometry, like `media`'s external texture —
  **the effect is not yet vetted**; the triangle raster it feeds IS proven byte-identical via injection);
  vendoring the reference engine for a standalone published package (today the parity harness + example
  import the sibling reference by path). (WebGPU dropped — the WebGL2 shader path is the deliverable.)

Local-only; **not pushed**. Commits omit the `Co-Authored-By` trailer.
