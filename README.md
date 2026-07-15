# Noisemaker for Babylon.js

> Run **Noisemaker**'s procedural visuals in **Babylon.js**.

## What is this?

**Noisemaker** is a procedural visual engine. You write tiny text programs — chains of
effects — and it renders live, animated GPU textures:

```
search synth, filter
noise(scaleX: 60).bloom().write(o0)
render(o0)
```

That little language is Noisemaker's **DSL** (a domain-specific language for visuals). The original
engine runs in the browser at [noisedeck.app](https://noisedeck.app).

**Noisemaker for Babylon.js** runs that same engine inside **Babylon.js** — the same programs and the same
~210 effects, rendered as part of a Babylon scene. Use it to make textures, materials, skyboxes, and
animated backgrounds from code, with no image files.

Babylon.js is JavaScript over WebGL2/WebGPU — the exact environment Noisemaker already targets — so
**nothing is translated**. This port runs the **published engine as-is** and adds two small pieces:
a `BabylonBackend` (the Backend-interface impl) and a `NoisemakerRenderer` host that exposes the
result as a Babylon texture.

## What you can do with it

- **Generate animated textures** from a short program — noise, gradients, patterns, color grades,
  blurs, warps.
- **Run simulations on the GPU** — particle/agent systems (flocking, slime/physarum, diffusion) and
  fluid (navier–stokes).
- **Render 3D volumes and bake cubemaps** — raymarched noise volumes, skyboxes, PBR reflections.
- **Use the result anywhere a Babylon texture goes** — materials, skyboxes, reflections, backgrounds.

## Requirements

- **Node.js + npm** — to fetch the engine and run the tooling.
- **`@babylonjs/core` v9** — a peer dependency (your host app provides it).
- **A WebGL2 environment** — a browser; the parity tests run headless via Playwright / Chromium.

## Install

The engine itself is **not committed** to this repo. `vendor/fetch.sh` downloads the published
distribution from the CDN (`shaders.noisedeck.app`) into a git-ignored `vendor/` — the same posture
as `node_modules` (the fetch script is committed, never the downloaded bytes).

```bash
npm install            # @babylonjs/core (peer) + dev tooling
bash vendor/fetch.sh   # fetch the published engine into vendor/noisemaker/ (gitignored)
```

## Your first render

First, turn a DSL program into a runnable **fat graph** (the render graph with shader source
attached):

```bash
node tools/export-fat-graph.mjs "search synth
noise(seed: 1, scaleX: 30, colorMode: 1, speed: 25).write(o0)
render(o0)" demo.fatgraph.json
```

Then load it and render a frame:

```js
import { Engine } from '@babylonjs/core/Engines/engine.js'
import { Pipeline } from './vendor/noisemaker/noisemaker-shaders-core.esm.js'
import { NoisemakerRenderer } from './src/runtime/renderer.js'
import fatGraph from './demo.fatgraph.json'

const engine = new Engine(canvas, true)
const nm = new NoisemakerRenderer(engine, { Pipeline, size: 512 })
await nm.loadGraph(fatGraph)
nm.renderFrame(0)              // render one frame at normalized time 0
```

**Every DSL program** has the same shape: name the namespaces it uses (`search synth, filter`),
chain effects, write the result to an output surface (`.write(o0)`), then pick one to show
(`render(o0)`).

## Use it in your own Babylon project

> **Install into your own project.** This package isn't published to npm yet. Until it is, install
> it from git — `npm i github:noisefactorllc/noisemaker-for-babylonjs` — or vendor `src/runtime/` into
> your app and run `vendor/fetch.sh` to pull the engine. The snippets here import the renderer by
> its in-repo path (`./src/runtime/renderer.js`); the demos in `examples/` import it as
> `../src/runtime/renderer.js`.

`NoisemakerRenderer` keeps a stable output texture you can hand straight to any material, and drives
the effect forward each frame:

```js
// Use the live output as a texture on any material:
const tex = new Texture(null, scene)
tex._texture = nm.outputInternalTexture
material.diffuseTexture = tex

engine.runRenderLoop(() => { nm.renderFrame(t); scene.render() }) // t normalized 0..1
```

Bake a composition into a cube texture for a skybox or PBR reflection:

```js
const { cubeTexture } = await nm.renderCubemap({ size: 512 })
// wrap cubeTexture in a Babylon CubeTexture for scene.reflectionTexture / a skybox
```

Two runnable demos (`node examples/build.mjs`, then open the HTML):

- **`examples/index.html`** — a Noisemaker effect as a live texture on a spinning box.
- **`examples/cubemap.html`** — a baked Noisemaker cubemap as a skybox + reflective sphere.

## What works today

- The **whole effect catalog** (~210 effects: noise, filters, mixers, classic generators, including
  the full 2026-07 artistic-filter release) renders, and is **byte-identical to the web reference** —
  the candidate runs on the same WebGL2 driver as the reference, so the match is exact (no rounding
  tolerance).
- **Every mode of every artistic filter**, not just its default — 101 (effect, mode) fixtures across
  19 effects (texture's 15 modes, hatch's 6, morphology's dilate/erode × square/round, …) — is also
  byte-identical. See [STATUS.md](STATUS.md) for the full matrix.
- **Particle/agent sims and fluid (navier–stokes)** render and match the reference.
- **3D-volume raymarch and cubemap bake** render and match — usable as Babylon skyboxes / PBR
  reflections.
- **The live NoiseBLASTER! corpus** — real shared compositions — matches the reference; see
  [STATUS.md](STATUS.md) for the current pass count.
- The only gaps are **4 effects that need a live external input** (`media`, `text`, `roll`,
  `meshLoader`) — three of the four (`media`/`text`/`roll`) are additionally verified byte-identical
  on their no-input fallback path.

Coverage table, parity numbers, and known limits: **[STATUS.md](STATUS.md)**.

## How it works

Noisemaker turns a DSL program into a **render graph** — a normalized list of GPU passes. That graph
is the shared seam every Noisemaker port targets. This port goes one level deeper: it reuses the
published compiler and `Pipeline` unchanged and adds a **`BabylonBackend`** that satisfies the
engine's `Backend` interface, so the unchanged `Pipeline` runs on `@babylonjs/core`. The effect
shaders are GLSL ES 3.00, used as-is.

→ **[ARCHITECTURE.md](ARCHITECTURE.md)** (how it maps onto Babylon) ·
**[PORTING-GUIDE.md](PORTING-GUIDE.md)** (backend notes + engine quirks).

## Contributing

The port consumes the published engine, so it needs nothing else checked out. The **dev/parity
tooling** renders both the reference goldens and the Babylon candidates through that same vendored
engine (only the backend differs), so a same-engine diff is exact:

```bash
npm install && bash vendor/fetch.sh    # deps + fetch the published engine (gitignored)
python3 -m venv parity/.venv && parity/.venv/bin/pip install numpy pillow   # compare.py deps
npx playwright install chromium        # headless browser for the candidate renders
bash parity/sweep.sh                    # candidates via BabylonBackend, graded against the committed goldens
bash parity/run.sh noise                # just one program
#   -> [PASS] noise: max-abs-diff=0 ...
```

`parity/sweep.sh` grades against whatever goldens are already committed — it does not mint them. A few
effects (`watercolor`, the chaotic iterative solvers) are sensitive enough to time/GPU-scheduling that a
golden minted hours apart from the candidate can show a spurious few-percent diff even though the two
backends are byte-identical when minted together (see PORTING-GUIDE.md). To re-verify from a clean
slate, re-mint goldens immediately before sweeping:
```bash
NM_GOLDEN=1 node parity/render-batch.mjs $(ls parity/programs/*.dsl | xargs -n1 basename | sed 's/\.dsl$//' | grep -v '^corpus_')
bash parity/sweep.sh
```

→ **[STATUS.md](STATUS.md)** (coverage + parity results) · `reference/01–10` (engine specs shared
across all Noisemaker ports).

## Repo layout

```
src/runtime/babylonBackend.js   the Backend impl on @babylonjs/core
src/runtime/renderer.js         NoisemakerRenderer host (stable output texture for materials)
tools/export-fat-graph.mjs      DSL → runnable "fat graph" (compiler + GLSL attached)
vendor/fetch.sh                 fetches the published engine from the CDN (gitignored)
examples/                       Babylon scenes: effect-as-texture, cubemap skybox
parity/                         golden-image test harness + DSL programs + live corpus
reference/01–10                 engine specs shared across all Noisemaker ports
ARCHITECTURE.md  PORTING-GUIDE.md  docs/   design, porting notes, build plan
STATUS.md                       coverage table, parity results, known limits
```

## License

MIT (see [LICENSE](LICENSE)). Use of the Noisemaker and Noise Factor names in derivative products is
subject to the [Trademark Policy](TRADEMARK.md).

Copyright © 2026 Noise Factor LLC
