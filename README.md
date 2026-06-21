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

**149 / 152 renderable-2D effects pixel-identical at strict tolerance** (max-abs-diff ≤ 2, most
exactly 0), graded against the byte-identical reference WebGL2 goldens. Because the candidate
renders on the same WebGL2/ANGLE/Metal driver as the golden, **no effect needs the relaxed
per-effect tolerances the Metal-backed Unity/Godot/TD ports required** — and the continuous solvers
`reactionDiffusion` + `navierStokes`, which those ports document as cross-backend-divergent skips,
**pixel-parity byte-identically here** when evolved ~30s to a deterministic steady state. The 3
skips are external-input effects (media/text/remap). The **10 points/agent sims** (physarum, life,
flock, …) render correctly via the MRT + points executor (162 programs render, 0 errors) but aren't
strict-graded (chaotic deposit sims). Remaining staged: 3D-volume raymarch + mesh + cubemap.

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
NM_REFERENCE_ROOT=../noisemaker node examples/build.mjs   # bundle + generate demo.fatgraph.json
# open examples/index.html  (a Noisemaker effect as a live texture on a spinning box)
node examples/verify.mjs                                  # headless render check
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
half-float, and readback are done and parity-verified. **Staged:** MRT + `drawMode:points` agent
effects, 3D volumes/meshes, the WebGPU path (same shaders via Babylon's GLSL→WGSL), and vendoring
the reference engine for a standalone published package. Local-only; not pushed. See PORTING-GUIDE.md.

## License

MIT (matching the reference). Noisemaker is a trademark of Noise Factor LLC.
