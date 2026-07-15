# Noisemaker for Babylon.js — Implementation Plan

A Babylon.js port of the Noisemaker procedural shader engine (DSL compiler, render-graph
executor, effects collection), pixel-identical to the reference WebGL2 engine. Sibling to
`noisemaker-for-unity` (Unity), `noisemaker-for-godot`, `noisemaker-for-touchdesigner`.

## The key insight: a deeper seam than the foreign-language ports

The foreign-language ports (Unity/C#, Godot/GDScript, TD/Python) had to re-implement the
render-graph executor in the target language, taking on parity risk in the pipeline logic
(texture pool, three-tier ping-pong, surface swap predicates, uniform packing, frame loop).

**Babylon.js is JavaScript driving WebGL2/WebGPU — the exact reference environment.** The
reference `Pipeline` (`shaders/src/runtime/pipeline.js`) is constructed as
`new Pipeline(graph, backend)` and drives a *swappable* `backend` object (the abstract
`Backend` class in `shaders/src/runtime/backend.js`; concrete `WebGL2Backend` / `WebGPUBackend`
are injected by the host `canvas.js`). So the seam can be pushed one level deeper than the
render-graph JSON:

```
            reference JS (reused verbatim)                    new code
   ┌───────────────────────────────────────────┐   ┌────────────────────────┐
   DSL ─► lex/parse/validate/expand ─► compileGraph ─► Pipeline ──drives──►  BabylonBackend
          (lang/, runtime/expander)    (runtime/        (runtime/             (Backend impl on
                                        compiler.js)     pipeline.js)          @babylonjs/core)
   └───────────────────────────────────────────┘   └────────────────────────┘
```

We reuse the **compiler + expander + pipeline** (every parity-critical thing) unchanged, and
implement **one new component**: a `BabylonBackend` satisfying the `Backend` interface, using
Babylon's GPU resource abstractions. Shaders are reused **verbatim** — Babylon's WebGL2 path is
GLSL ES 3.00 with the same `gl_FragCoord` bottom-left origin as the reference. This collapses
the golden/live producer distinction (both are literally the reference compiler) and removes
nearly all pipeline parity risk. The only parity surfaces are (a) `BabylonBackend` matching
`webgl2.js`'s GPU operations and (b) Babylon not mangling the reused GLSL.

## The Backend interface to implement (`backend.js`)

`init()`, `createTexture(id, spec)`, `createTexture3D(id, spec)`, `destroyTexture(id)`,
`compileProgram(id, spec)`, `executePass(pass, state)`, `beginFrame(state)`, `endFrame()`,
`copyTexture(srcId, dstId)`, `clearTexture(id)`, `present(textureId)`, `getName()`,
`readPixels(textureId)` (for parity), plus the public fields `textures` (Map id→handle),
`programs` (Map), `capabilities`.

### GL → Babylon mapping (from `webgl2.js`)

| `webgl2.js` operation | Babylon equivalent |
|---|---|
| `createTexture` → `gl.texImage2D` + NEAREST/CLAMP, FBO if `usage∋'render'` | `engine.createRenderTargetTexture(size, {type, format, samplingMode:NEAREST, wrap:CLAMP, generateDepthBuffer:false, generateMipMaps:false})`; non-render → `engine.createRawTexture` |
| format `rgba8/rgba16f/rgba32f/r8/r16f/r32f` | `TEXTUREFORMAT_RGBA`/`R` × `TEXTURETYPE_UNSIGNED_BYTE`/`HALF_FLOAT`/`FLOAT` |
| **all 2D textures NEAREST min/mag, CLAMP_TO_EDGE S/T** | `TEXTURE_NEAREST_SAMPLINGMODE`, `TEXTURE_CLAMP_ADDRESSMODE` (load-bearing for warp effects) |
| `compileProgram` → `injectDefines` (`#version 300 es`+precision+defines, strip src `#version`) + `DEFAULT_VERTEX_SHADER` | Raw-GLSL Effect compile (path TBD per Babylon-API brief; must NOT let Babylon rewrite the body) |
| `executePass`: bind FBO (global→`state.writeSurfaces`), viewport=output size | `engine.bindFramebuffer(rtWrapper)` |
| MRT (`drawBuffers>1` or >1 output) | `MultiRenderTarget` / `engine.bindAttachments` |
| `bindTextures`: sampler by name, missing→1×1 black `defaultTexture` | `effect.setTexture(name, tex)`; keep a 1×1 black fallback |
| `bindUniforms`: pass.uniforms then globalUniforms, by GL type | `effect.setFloat/Int/Vector2/3/4/Array/Matrix`; bool→0/1 |
| blend: array→`blendFunc`, truthy→additive `ONE,ONE`, else off | `engine.setAlphaMode(ALPHA_ADD / custom / ALPHA_DISABLE)` |
| draw fullscreen triangle (3 verts), or POINTS/billboards/triangles | `EffectRenderer` fullscreen, or manual VAO draw for points/mesh |
| `present`: blit to canvas (Y reconciled here only) | fullscreen blit effect |
| `readPixels`: float→`round(v*255)`, flip bottom-up→top-down | `engine.readPixels` / `rtt.readPixels`, match quantize + orientation |

### Engine/system uniforms (fed by name every pass, from `pipeline.updateGlobalUniforms`)
`resolution=[w,h]`, `time` (**normalized 0..1**, loop default 10s), `deltaTime`, `frame`,
`tileOffset=[0,0]`, `fullResolution=[w,h]`, `aspectRatio=w/h`, `renderScale=1`. Coordinate
convention in every effect: `st = (gl_FragCoord.xy + tileOffset) / fullResolution.y` (divide
by HEIGHT). `define`-params (`NOISE_TYPE`, `LOOP_OFFSET`) injected as `#define` before compile.

## Shader reuse

Reference `shaders/effects/<ns>/<dir>/glsl/<program>.glsl` files are used **verbatim** (no
language translation). Per-effect helpers (prng, periodicFunction, hsv2rgb, rotate2D, distance
metrics) are copied with the file; only `pcg`/`map` are universal. Each file is self-contained
(no `#include`). PCG divisor `4294967295.0`. Render targets carry no hardware sRGB; shaders do
sRGB math explicitly.

## Phasing

- **P0 Scaffold** ✓ — dir, `@babylonjs/core` v9, reuse reference specs `01–10` + `tools/`,
  parity corpus (87 `.dsl` + byte-identical goldens) + `compare.py` + venv, git.
- **P1 Backend + first-effect parity** — minimal `BabylonBackend` (createTexture, compileProgram,
  executePass single-output, readPixels) + a browser harness that runs `compileGraph`+`Pipeline`
  +`BabylonBackend` under Playwright; drive `synth/noise` to pixel-parity vs golden. **The gate.**
- **P2 Full executor** — MRT, points/billboards draw modes, blend, copyTexture/clearTexture,
  3D textures, present; reuse the full reference `Pipeline` (ping-pong/iteration-swap come free).
- **P3 Tier-1 parity sweep** — drive all 87 programs through the Babylon candidate; grade with
  `compare.py` against reused goldens. Candidate is WebGL2 → expect tighter parity than the
  Metal-backed ports (may tighten the relaxed-tolerance table).
- **P4 Integration surfaces** — `ProceduralTexture` / `PostProcess` / `Texture` wrappers so a
  Babylon scene can consume noisemaker effects; host API (getOutput, setUniform, resize).
- **P5 WebGPU** — same shaders via Babylon's WebGPU engine (GLSL→WGSL transpile or authored WGSL).
- **P6 Docs + examples + memory.**

## Parity harness
- Goldens AND candidates both run the vendored published engine; only the backend differs (golden =
  `WebGL2Backend` via `NM_GOLDEN=1`, candidate = `BabylonBackend`). Capture params: 256×256,
  normalized time 0.25, 8 frames (stateful effects evolve ~30s), linear 8-bit.
- `parity/run.sh <name> [tol] [ssim]` renders the Babylon candidate, grades with `compare.py`
  (default `tol=2.001`, `ssim=0.98`). `parity/sweep.sh` runs all (corpus excluded — own harness).
- Golden mint/refresh: `NM_GOLDEN=1 node parity/render-candidate.mjs <name> --out parity/out/<name>.golden.png`.

## Constraints
- Local-only; **do not push** without instruction. Omit `Co-Authored-By` on commits.
- Additive: never modify the reference engine. The port consumes it read-only.
