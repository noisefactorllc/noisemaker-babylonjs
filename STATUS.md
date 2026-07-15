# Noisemaker for Babylon.js — status & parity

*Last verified 2026-07-14. The sources of truth are `parity/sweep.sh`, `parity/corpus/sweep.sh`, and
`tools/catalog.mjs`.*

This file holds the detailed coverage and parity numbers. For what the project is and how to use it,
see the [README](README.md).

## Coverage

**210 catalogued effects** (`tools/catalog.mjs`) — up from 185. The CDN republished `/1` in place with
the full artistic-filter release: **25 new effects**, all `filter/*` (`chrome`, `craquelure`,
`directionalBlur`, `extrude`, `halftone`, `hatch`, `highPass`, `lensFlare`, `median`, `morphology`,
`mosaicTiles`, `oilPaint`, `patchwork`, `photocopy`, `plasticWrap`, `pondRipples`, `relief`, `scatter`,
`spinBlur`, `stamp`, `stipple`, `strokes`, `unsharpMask`, `watercolor`, `wind`), plus content changes to
12 existing effects (`dither`, `edge`, `emboss`, `grain`, `invert`, `lowPoly`, `parallax`,
`temporalAberration`, `texture`, `channelCombine`, `mandala`, `sacredGeometry` — mostly new modes/params
on the artistic filters) and the engine core itself.

**All 206 byte-verifiable effects are byte-identical** (max-abs-diff 0); the same 4 effects as before
need a live external input the headless harness can't supply deterministically — see Known limits below
(three of the four now additionally verified byte-identical on their no-input fallback path).

| Group | What's in it | State |
|---|---|---|
| 2D effects | noise, filters, mixers, classic generators (179 renderable, incl. all 25 new artistic filters) | byte-identical |
| Agent / points sims | physarum, life, flock, dla, lenia, … (10) | byte-identical |
| Continuous solvers | `reactionDiffusion`, `navierStokes` | byte-identical (evolved, see below) |
| 3D-volume raymarch | 7 `synth3d` generators × `render3d` / `renderLit3d` (isosurface + voxel), `flow3d`, `palette3d` | byte-identical |
| Cubemaps | `renderCubemapSurface`, `renderCubemap3d` — single-face + 6-face bake | byte-identical (all 6 faces) |
| Wrappers & routing | SMRTicles (`pointsEmit` / `pointsRender` / `pointsBillboardRender`), `loopBegin` / `loopEnd`, `wormhole`, `remap` (std140 UBO) | byte-identical |
| External-input | `media`, `text`, `roll`, `meshLoader` | media/text/roll byte-identical on their no-input fallback (policy-skipped, see Known limits); meshLoader has no fixture |

## Mode coverage (new this round)

Verifying each effect's **default** program is no longer the bar: every enum/define-selected **mode**
of the artistic-filter family is now proven individually. **101 (effect, mode) fixtures across 19
effects**, each minted as its own DSL program + golden via the vendored engine and graded against the
`BabylonBackend` candidate at strict byte-exact (max-abs-diff 0):

| Effect | Modes covered | Cases |
|---|---|---|
| `texture` | all 15: canvas, crosshatch, halftone, paper, stucco, regular, soft, sprinkles, clumped, contrasty, enlarged, stippled, horizontal, vertical, speckle | 15 |
| `dither` | type (8) + palette (9 non-default of 10) — see note below | 17 |
| `strokes` | angled, sprayed, dark, sumiE, smudge | 5 |
| `hatch` | all 6: pen, charcoal, chalkCharcoal, conte, crosshatch, coloredPencil | 6 |
| `lowPoly` | mode (flat/edges/distance2/distance3) + border/light compile-time toggles | 6 |
| `oilPaint` | facet, daubs, dryBrush, fresco, knife, sponge | 6 |
| `stipple` | all 5: pointillize, mezzoDots, mezzoLines, mezzoStrokes, reticulation | 5 |
| `pondRipples` | style (3) + wrap (2 non-default) | 5 |
| `scatter` | normal, darkenOnly, lightenOnly, anisotropic, clumped | 5 |
| `halftone` | mode(color/mono) × pattern(dot/line/circle under mono) | 4 |
| `morphology` | mode(dilate/erode) × shape(square/round), full cross | 4 |
| `edge` | kernel(fine/bold/contour) + contourSide(upper under contour) | 4 |
| `lensFlare` | zoom50_300, prime35, prime105, moviePrime | 4 |
| `relief` | basRelief, plaster, notePaper | 3 |
| `extrude` | type(blocks/pyramids) + depthSource(random) | 3 |
| `wind` | wind, blast, stagger | 3 |
| `emboss` | color, gray | 2 |
| `invert` | full, solarize | 2 |
| `mosaicTiles` | mosaic, shifted | 2 |

Full data: [`parity/mode-coverage.json`](parity/mode-coverage.json) (the 101-row effect×mode ledger) and
[`parity/ledger.json`](parity/ledger.json) (all 314 graded programs — full roster + mode matrix).
Regenerate the fixtures with `node tools/gen-mode-programs.mjs`.

**Scope note.** The crystallization brief named 13 effects as its (explicitly non-exhaustive) example
list: `texture`, `strokes`, `lowPoly`, `emboss`, `invert`, `hatch`, `halftone`, `relief`, `stipple`,
`mosaicTiles`, `morphology`, `grain`, `edge`. Checked against the vendored ground truth:
- Several of the brief's choice sets were approximate — the vendored definitions were used instead
  (`texture` actually has 15 modes, not 10; `hatch` has 6, not 4; `stipple` has 5, not 3).
- **`grain`'s definition (`vendor/noisemaker/effects/filter/grain.js`) has no enum/mode parameter at
  all** — only `alpha` (float) and `pause` (bool). "grain{~10 types}" does not match ground truth.
  `dither.palette` has exactly 10 choices and `dither` changed content in this exact vendor sync, so it
  is included in grain's place as the better-evidenced match (see `tools/gen-mode-programs.mjs`).
- The other 6 new effects that also carry an enum mode but weren't in the brief's list are included
  too: `extrude`, `lensFlare`, `oilPaint`, `pondRipples`, `scatter`, `wind`.
- Long-standing enum params on pre-existing (not new/changed) effects — `noise`'s 9-way `NOISE_TYPE`,
  `kaleido`'s 29-way `LOOP_OFFSET`, `classicNoisedeck/bitEffects`'s 14-way `colorScheme`, etc. — are
  **not** included in this matrix; they predate this crystallization round and are covered at
  default-parity by the general roster sweep, consistent with the prior 181/185 baseline. A blind scan
  of every `choices`-bearing global across all 210 effects turns up ~490 cases, the large majority on
  effects unrelated to the artistic-filter release this round crystallizes.

## Parity

- **Whole catalog + mode matrix, freshly paired (this round's crystallization):** 314/314 programs
  (roster + 101 mode-matrix fixtures) byte-identical (max-abs-diff 0) when golden and candidate are
  minted in the same pass — see "A found-and-fixed false failure" below for why "freshly paired"
  matters. 311 are strict-graded via `parity/sweep.sh`'s policy; `media`/`text`/`roll` are
  policy-skipped (numerically pass too — see Known limits). Because the candidate renders on the
  **same WebGL2 / ANGLE / Metal driver** as the golden, the match is exact — the per-effect
  relaxed-tolerance safety net (`newton`, `shadow`, `uvRemap`, `distortion`, `edge`, `pinch`, `crt`)
  that `parity/sweep.sh` used to carry has been **retired**: a full re-grade proved all of them
  byte-exact too, so the sweep now grades everything at a flat max-abs-diff-0/ssim-0.999 gate.
- **Stateful / continuous / agent effects** are evolved ~30s (the `EVOLVE` map in `render-batch.mjs`)
  to a bit-identical steady state before grading — including `reactionDiffusion`, which an earlier
  version of this doc described as "not bit-reproducible"; re-tested this round, it is byte-identical
  at the same evolved steady state as every other continuous solver.
- **Mode matrix (`parity/mode-coverage.json`):** 101/101 byte-identical.
- **End-to-end:** the complex emergent test program — 3D perlin → 1M-agent flow-field particles
  (MRT + points + billboards) → blur → `navierStokes` ×40 → palette / lighting / adjust / bloom /
  lens / vignette — is byte-identical at every 5 s sample over 30 s.
- **Live NoiseBLASTER! corpus (`parity/corpus/`):** live feed re-fetched this round (accumulated to 40
  raw compositions across sessions; the harness never deletes old ones). **39/39 gradeable
  byte-identical** (1 pre-filtered: a composition using an effect the reference compiler itself
  rejects, unrelated to this port). Several of the 40 now use the newly-published artistic filters,
  e.g. "parallax heighmap" and "parallax cells".

### A found-and-fixed false failure: stale goldens, not a backend bug

Re-verifying this round surfaced **3 roster programs** (`watercolor`, `navierStokes`, `target`) and
**3 corpus compositions** failing at a real, reproducible max-abs-diff (not zero) against their
*already-committed* goldens. Investigated by direct test (mint golden and candidate back-to-back
several times vs. compare against an hours-old golden): a **golden and a candidate minted in the same
pass are always byte-identical**; the *same* golden compared against a candidate rendered hours (or,
for the corpus case, days) later can show a spurious few-percent diff. This is **not** a
`BabylonBackend` bug — a golden re-minted fresh (via the reference `WebGL2Backend`) drifts by the exact
same amount, so the instability is in the published shader/engine itself (most likely an
uninitialized-texture read whose value depends on GPU memory reuse patterns), and it affects both
backends identically. The fix: **re-mint goldens and candidates together**, immediately before
grading — not treat `parity/out/*.golden.png` as a stable baseline to diff a candidate against
indefinitely. All affected goldens were re-minted this round; `parity/sweep.sh` and
`parity/corpus/sweep.sh` do **not** mint goldens themselves (see PORTING-GUIDE.md's Parity workflow
section for the corrected two-step invocation). This does not weaken the byte-exact gate — it is still
max-abs-diff 0 everywhere — it only changes the operational discipline for *taking* that measurement.

Goldens and candidates both render through the **same vendored engine** — the reference
`WebGL2Backend` mints the goldens (`NM_GOLDEN=1`), the `BabylonBackend` renders the candidates — so
this is a true same-engine diff, not a cross-implementation comparison.

## This round's vendor sync (185 → 210)

`bash vendor/fetch.sh` re-pulled `/1` in place. Diffed byte-for-byte against the prior vendored state:

- **Manifest: 185 → 210** (+25, 0 removed). All 25 new effects are `filter/*`, single-input,
  non-staged (no MRT/points/3D) — see Coverage above.
- **Engine core changed**: `noisemaker-shaders-core.esm.js` 711011 → 711810 bytes. Build tag (the
  mtime-hex component of the CDN's nginx ETag for the core bundle, `<mtime_hex>-<size_hex>`,
  which is size-consistent: `0xadc82` = 711810 bytes) moved **`29725b18` → `6a56923b`**
  (Last-Modified Tue, 14 Jul 2026 19:47:07 GMT).
- **12 existing mini-bundles changed content** (beyond the 25 new files):
  `filter/dither.js`, `filter/edge.js`, `filter/emboss.js`, `filter/grain.js`, `filter/invert.js`,
  `filter/lowPoly.js`, `filter/parallax.js`, `filter/temporalAberration.js`, `filter/texture.js`,
  `mixer/channelCombine.js`, `synth/mandala.js`, `synth/sacredGeometry.js` — mostly new mode/param
  surface on the artistic filters (`texture`, `lowPoly`, `emboss`, `invert`, `edge` all gained the
  enum params exercised in the Mode coverage matrix above).
- Per the coordinator's brief, confirmed directly against the vendored source: `filter/strokes.js` has
  **zero pipeline pass-conditions**, uses the compile-time `MODE` `#define` (`globals.mode.define`,
  same mechanism as every other artistic-filter mode param), and **no longer references `stkErode`**
  (`grep -rl stkErode vendor/noisemaker` finds nothing). **The previously-documented "large unpublished
  reference delta" blocker is CLOSED** — `vendor/fetch.sh` now pulls the corrected, complete release
  directly from `/1`; nothing about this port needed to change to consume it.
- Per the crystallization brief's precedent (commit `a4dbdaa`), **every** previously-tracked golden was
  re-minted through the re-vendored engine (not just the ones known to have changed) and every
  candidate re-rendered and re-graded — 314/314 non-corpus programs (roster + mode matrix), all
  byte-identical.

## Known limits

Four effects need a runtime input the headless parity harness can't supply deterministically. Three of
the four now additionally render **byte-identical on their no-input fallback path** — proving the base
plumbing is correct on both backends — but stay policy-skipped in `parity/sweep.sh`: a pass on the
fallback path is necessary, not sufficient, evidence, since it doesn't exercise the actual external-data
upload (a real image, a real glyph atlas, a real MIDI stream), which the headless harness can't supply.

| Effect | Namespace | External input it needs | This round |
|---|---|---|---|
| `media`      | `synth`  | a host-supplied image/video texture | unchanged — byte-identical on the no-input fallback (already true before; re-confirmed) |
| `text`       | `filter` | rasterized glyphs (a font / glyph atlas) | unchanged — byte-identical on the no-input fallback (already true before; re-confirmed) |
| `roll`       | `synth`  | a MIDI / piano-roll event stream | **newly fixtured and fixed this round** — see below |
| `meshLoader` | `render` | host-side OBJ geometry (vertex / index buffers) | unchanged — still no fixture (see below) |

**`roll` — new finding + fix.** `roll` had never had a parity fixture before this round (`tools/catalog.mjs`
flagged it "missing renderable" the same as the 25 new effects). Generating one exposed a real
`BabylonBackend` gap: `TypeError: this.backend.uploadDataTexture is not a function`. The vendored
engine core calls `backend.uploadDataTexture('midiNoteGrid', noteGrid|emptyNoteGrid, 128, 16)` on
**every** `roll` render — whether or not a live MIDI source is attached, the empty-grid fallback still
needs the method to exist. `BabylonBackend` had no `uploadDataTexture` at all. Fixed in
`src/runtime/babylonBackend.js`: mirrors `webgl2.js`'s implementation (create-or-resize an RGBA32F
NEAREST/CLAMP texture, `texSubImage2D` to update), built on the backend's own `createTexture` +
`_glTexOf` so the result is a normal texture record any later sampler lookup already finds. Verified
byte-identical after the fix (`roll`'s no-MIDI empty-grid fallback matches the golden exactly). Still
policy-skipped, same reasoning as media/text: the fix closes the crash and proves the fallback path is
correct; actually routing live MIDI events into the effect remains a documented follow-up (unchanged).

**`meshLoader` — unchanged.** Still no parity fixture (it's `staged`, outside `tools/gen-programs.mjs`'s
renderable-2D scope). The triangle-raster pass it feeds, `render/meshRender`
(`drawMode:'triangles'`, depth-test + back-face cull + `gl_VertexID` geometry fetch, Blinn–Phong-lit),
remains separately proven byte-identical by injecting an identical procedural sphere into both engines'
mesh textures. Only the host OBJ-load → mesh-surface upload step is unvetted.

**Follow-up work**

- **`media`** — upload host media into a surface and sample it. Expected to need **no new backend
  code** (it's a plain texture read), once a deterministic image source is wired into the harness.
- **`text`** — supply a glyph-atlas texture (e.g. rasterized via Canvas2D) as the input surface; it
  then runs as a standard input filter.
- **`roll`** — the backend-interface gap (`uploadDataTexture`) is now closed; what remains is routing
  real host MIDI events into `externalState.midi.noteGrid` for a live (not just empty-fallback) check.
- **`meshLoader`** — parse OBJ → populate the mesh surfaces. **The triangle-raster path it feeds is
  already proven byte-identical**; only the host OBJ-load → mesh-surface step is unvetted.
- **Standalone package.** The port consumes the published engine at build/test time via
  `vendor/fetch.sh` (gitignored — the `node_modules` posture). Packaging `noisemaker-for-babylonjs` itself
  as a distributable npm module (that fetches the engine on install) is open.
- **Unpublished reference delta: CLOSED this round** (see "This round's vendor sync" above) — no
  longer a follow-up item. `vendor/fetch.sh` is the only source of truth for this port; it never reads
  the sibling reference checkout.

## How the 3D / cubemap / remap paths work

These are the only places the backend does anything beyond the basic single-output / multi-pass /
input-filter / mixer / blit / blend / readback path.

- **3D volumes are 2D atlases.** The 3D-volume raymarch and cubemaps fell out of the *existing* MRT
  path with **zero new backend code** — the "volume" is a 2D atlas the Pipeline sizes to 64×4096,
  sampled via `texelFetch`. `createTexture3D` is never called.
- **Cubemap bake.** `NoisemakerRenderer.renderCubemap()` drives the reused `Pipeline.renderCubemap()`
  6-face loop (per face it sets the `cubeBasis` camera basis, renders, reads back) and bakes the
  faces into a **Babylon-native cube texture** — usable directly as a skybox / PBR reflection (the
  parallel of the HLSL port's Unity-native cubemap). **All 6 faces are byte-identical** for both
  `renderCubemapSurface` and `renderCubemap3d`; `examples/cubemap.html` renders a live skybox +
  reflective sphere from a baked noise volume.
- **`remap` and the std140 UBO.** `remap` is the **sole** effect whose WebGL2 GLSL declares a
  `layout(std140) uniform` block — its 8-zone polygon config (267 `vec4` slots) is uploaded as a
  packed **UBO**, a path the backend mirrors from `webgl2.js` byte-for-byte (`extractUniformBlocks` +
  `packUniformsWithLayout`). Both the default `remap(bgColor:#336699)` and a non-trivial 2-zone
  routing config (`parity/programs/remap_zones.dsl`) are byte-identical. (~31 other effects *declare*
  a `uniformLayout` but use plain uniforms in WebGL2 — the layout is WGSL/fallback metadata — so the
  UBO bind is a no-op for them. `remap` was originally mis-filed as external-input; its inputs are
  engine surfaces, and fixing it made even the default `remap(bgColor)` correct.)
- **The genuinely-new backend pieces.** Everything else reuses the existing path; only the mesh
  `drawMode:'triangles'` raster, the std140 UBO upload, and (this round) `uploadDataTexture` (the
  `roll`/MIDI data-texture path — see Known limits) are new.
- **The one load-bearing engine quirk.** The additive particle deposit must use raw
  `blendFunc(ONE, ONE)`; Babylon's `setAlphaMode(ALPHA_ADD)` is `(SRC_ALPHA, ONE)`, which crushes the
  HDR trail accumulation. See [PORTING-GUIDE.md](PORTING-GUIDE.md).
