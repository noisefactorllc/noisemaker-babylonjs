# noisemaker-babylon — Porting Guide

Unlike the Unity/Godot/TD ports, **there is no shader translation**: Babylon's WebGL2 path is
GLSL ES 3.00 with the same `gl_FragCoord` bottom-left origin as the reference, so effect shaders
are reused **verbatim** from `../noisemaker/shaders/effects/<ns>/<dir>/glsl/<program>.glsl`. The
work is making Babylon's `Effect`/`EffectRenderer` compile that raw GLSL pixel-exactly. The
hazards below were all load-bearing; each is handled once in `BabylonBackend`, not per effect.

## The five Babylon shader hazards (all fixed in `babylonBackend.js`)

1. **`#version 300 es` MUST be the first line.** Babylon's GLSL processor uses it to detect
   GLSL ES 3.00 and skip its ES1→ES3 migration. **90 of 247 reference shaders omit the version
   line** (the reference backend prepends it in `injectDefines`). Without it Babylon runs the
   migration on already-ES3 source (`out vec4`, `in`, `texture()`, `uvec3`, `floatBitsToUint`),
   which mangles the body → "Missing main()". Fix: strip any existing `#version` and prepend
   `#version 300 es` + `precision highp float;` + `precision highp int;` (PCG needs highp int).

2. **Don't use Babylon's default "postprocess" vertex** — it declares `uniform vec2 scale;`,
   which collides with effects that have their own `scale` uniform: *"Types of uniform 'scale'
   differ between VERTEX and FRAGMENT shaders."* Supply a custom minimal fullscreen vertex
   (`in vec2 position; gl_Position = vec4(position,0,1);`). Effects address pixels via
   `gl_FragCoord`, so no varying is needed.

3. **The version fix also prevents the `glFragColor` double-output.** For ES1-detected fragments
   Babylon injects `layout(location=0) out vec4 glFragColor;` *alongside* the shader's
   `out vec4 fragColor;` → *"must explicitly specify all locations when using multiple fragment
   outputs."* Taking the ES3 path (hazard 1) skips this injection.

4. **The reference `blit` program uses a `v_texCoord` varying** emitted by the reference vertex;
   Babylon's vertex doesn't supply it. Render blit passes with a `gl_FragCoord`/`texelFetch`
   copy instead (parity-equivalent for a same-size NEAREST blit). `BabylonBackend` skips
   compiling the reference `blit` and uses its own copy wrapper (pre-compiled in `init()`).

5. **`EffectRenderer.render` silently no-ops if the effect isn't ready.** Pre-compile every
   program and `await` readiness (`effect.isReady()`, polled) before the frame loop — otherwise a
   synchronous pass draws nothing and you get an all-zero (alpha 0) surface.

6. **The additive particle deposit MUST be raw `blendFunc(ONE, ONE)`.** Babylon's
   `setAlphaMode(ALPHA_ADD)` is `(SRC_ALPHA, ONE)` — it scales each deposit by its own alpha and
   *crushes the HDR trail accumulation* (dim, low-contrast agent sims). This is the highest-impact
   bug: it silently poisons every points/agent effect (physarum, flow, life, …) and any program
   that uses them. `_executePoints` sets the blend with raw `gl.blendFunc` (matching `webgl2.js`'s
   `resolveBlendFactor`: array → `blendFunc(src,dst)`; truthy → additive `ONE,ONE`) — safe because
   the deposit is a raw `gl.drawArrays`, not a Babylon-managed draw. With this fix all 10 agent
   sims + the live-corpus emergent stacks are byte-identical. (This is the "engine clamping/range"
   class of issue every cross-engine port of these sims hits.)

## The agent/points + MRT executor

Beyond fullscreen passes, `BabylonBackend` runs the GPGPU paths via raw `engine._gl` (Babylon owns
resource creation + shader compile; the draws mirror `webgl2.js` on the same context):
- **MRT** (`_executeMRT`): a raw FBO from the surfaces' WebGL textures
  (`internal._hardwareTexture.underlyingResource`), N color attachments in output-key order
  (= shader `layout(location=N)`), fullscreen draw via `EffectRenderer.bindBuffers`+`draw` into the
  bound FBO, `engine.wipeCaches(true)` after. Agent-state writes (`drawBuffers:3/4`) + 3D-volume
  precompute (`drawBuffers:2`).
- **points/billboards** (`_executePoints`): the deposit program ships a custom vertex
  (`spec.vertex` — `gl_VertexID` + `texelFetch` of the state texture); compile it (parse uniforms
  from both stages) and draw with an empty VAO, `gl.drawArrays(POINTS, count)` (billboards =
  `TRIANGLES, count*6`), count from the `xyzTex` state texture, raw additive blend.
- Surface formats are load-bearing: agent state is `rgba32f` (xyz/vel) + `rgba8` (rgba), trails are
  `rgba16f`. A 16f→32f substitution breaks continuous accumulators. No effect uses a real 3D
  texture — "3D" is a 2D atlas sampled via `texelFetch`.

## 3D-volume raymarch + single-face cubemaps: ZERO new code

The synth3d generators, `render3d`/`renderLit3d`, `filter3d`, and the single-face cubemap renderers
are all byte-identical through the **existing fullscreen + MRT path** — no 3D-specific backend code.
Why: the "3D volume" is a **2D atlas** (`volumeSize` x64 → a 64×4096 `rgba16f` target = 64 slices of
64²). The reference `Pipeline.recreateTextures` resolves the symbolic `{param:'volumeSize_chain_0',
power:2}` / `'screen'` / `'resolution'` dims to **numbers before** calling `backend.createTexture`
(so the Babylon backend just sees a 64×4096 target). The synth3d *precompute* and the render3d
*raymarch* are both fullscreen `drawBuffers:2` MRT passes (`{color, geoOut}`) that `_executeMRT`
already runs; shaders index the atlas with `texelFetch(volumeCache, ivec2(x, y + z·volSize))`.
`createTexture3D` is never called. The 6-face cubemap **bake** also needed no backend work: the reused
`Pipeline.renderCubemap()` (a per-face `setUniform('cubeBasis', mat3)` + `render` + `readPixels` loop)
drives the BabylonBackend directly — the only fix was coercing the mat3 uniform to a `Float32Array`
(`CUBE_FACE_BASES[face]` is a plain array; Babylon's `setMatrix3x3` wants a typed array). All 6 faces
are byte-identical for both renderers (`parity/cubemap-bake-check.mjs`). `NoisemakerRenderer.renderCubemap()`
wraps that loop and bakes the faces into a **Babylon-native cube `InternalTexture`** via
`engine.createRawCubeTexture` (Babylon's cube face order +X,-X,+Y,-Y,+Z,-Z matches the reference's, so
the 6 buffers drop straight in) — a skybox / PBR reflection, demoed in `examples/cubemap.html`.

## The mesh triangle raster (the one genuinely new pass type)

`render/meshRender` (`drawMode:'triangles'`) is the only staged pass type needing new code
(`_executeTriangles`): bind the output FBO, attach a `DEPTH_COMPONENT24` renderbuffer (Babylon RTs
are created `generateDepthBuffer:false`), `enable(DEPTH_TEST)`+`depthFunc(LESS)`, `enable(CULL_FACE)`
+`frontFace(CCW)`+`cullFace(BACK)`, `clear(DEPTH_BUFFER_BIT)`, then `drawArrays(TRIANGLES, 0, count)`
from the empty VAO — `count='input'` = the mesh position texture's texel count. The custom vertex
(already supported via `spec.vertex`) fetches xyz/normal per `gl_VertexID` from `global_mesh0_*`.
Two subtleties that mirror `webgl2.js`:
- **Chain-scope strip.** The expander references geometry as `global_mesh0_positions_chain_0`, but the
  Pipeline allocates it unscoped (`global_mesh0_positions`). `_resolveInput`/`_triCount` try the
  scoped id, then strip `_chain_\d+$` and retry (webgl2.bindTextures:1332). Without this the geometry
  binds to the 1×1 default and `count` falls back to 3.
- **External geometry.** `meshLoader` declares `externalMesh` — geometry is host-loaded from an OBJ,
  exactly like `media`'s external texture. The headless corpus renders empty (flat bg), which the
  triangles path reproduces byte-for-byte. To prove the raster itself, `parity/mesh-raster-check.mjs`
  injects an identical procedural sphere into **both** engines' mesh textures and compares: a
  depth-tested, back-face-culled, Blinn-Phong sphere, max-abs-diff 0.

## Parity invariants (same as the WebGL2 reference)

- Render targets: linear **half-float RGBA** (`rgba16f`), **NEAREST** min/mag, **CLAMP_TO_EDGE**
  wrap, no hardware sRGB. Some internal temps are `rgba8` (per the effect's `textures` spec).
- Coordinate convention in every effect: `st = (gl_FragCoord.xy + tileOffset) / fullResolution.y`
  — divide by HEIGHT. Feed `time` **normalized 0..1**, `tileOffset=[0,0]`, `fullResolution=[w,h]`,
  `aspectRatio=w/h`, `renderScale=1`.
- `define`-params (`NOISE_TYPE`, `LOOP_OFFSET`) come from `program.defines`, injected as
  `#define`s via Babylon's `defines` option (NOT as uniforms — they have no `uniform` field).
- Uniform upload order: pass uniforms first, then global/system uniforms (skip names already set).
  Bind sampler inputs by name; `none`/missing → a 1×1 transparent-black texture.
- Per-effect helpers (`prng`, `periodicFunction`, `hsv2rgb`, `rotate2D`, distance metrics) are
  copied with each shader and differ between effects — only `pcg`/`map` are universal. PCG divisor
  is `4294967295.0`. (We reuse the files verbatim, so this is automatic.)

## Parity workflow

Goldens are reused from `../noisemaker-godot/parity/out` (byte-identical: same DSL × same
reference WebGL2 renderer). The candidate must render on the **same driver** as the golden:
headless Chromium with `--use-angle=metal` (a real GPU — `NullEngine` cannot render).

```bash
# one effect (renders Babylon candidate + grades vs reused golden)
NM_REFERENCE_ROOT=../noisemaker bash parity/run.sh noise

# full sweep (one browser for all 87 programs, then grade with the tolerance map)
NM_REFERENCE_ROOT=../noisemaker bash parity/sweep.sh

# render the candidate through the consumer host (NoisemakerRenderer) instead of the raw backend
NM_VIA_RENDERER=1 node parity/render-candidate.mjs noise
```

Readback matches the golden exactly: read the surface as float, quantize `round(v*255)` clamped
to 0..255, flip rows bottom-up→top-down. Result: **86/87 pass at strict `max-diff ≤ 2.001`**
(most byte-identical); `reactionDiffusion` is the documented continuous-solver skip.

## Remaining staged pass types

MRT (`pass.drawBuffers>1` / multiple `outputs`), `drawMode:'points'|'billboards'` (agent deposit),
`drawMode:'triangles'` (mesh raster), 3D-volume raymarch, single-face cubemaps, AND the 6-face
cubemap bake (`NoisemakerRenderer.renderCubemap()`) are all implemented and parity-verified
(179/184 byte-identical; all 6 cube faces byte-identical). What's left:
- **Host OBJ loading for `meshLoader`** — parse `share/meshes/*.obj` and upload to the mesh surfaces
  (a `NoisemakerRenderer` concern, like wiring an external texture for `media`). The raster it feeds
  is already proven.
- **Vendoring** the reference engine for a standalone published package (today the harness + examples
  import the sibling reference by path).
