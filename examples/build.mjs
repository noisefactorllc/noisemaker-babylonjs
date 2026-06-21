#!/usr/bin/env node
// build.mjs — generate a demo fat graph from DSL + bundle the example for the browser.
//   node examples/build.mjs        # then open examples/index.html
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportFatGraph } from '../tools/export-fat-graph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Any Polymorphic-DSL program. Animated, colorized value noise here.
const DSL = 'search synth\nnoise(seed: 1, scaleX: 30, scaleY: 30, octaves: 3, colorMode: 1, speed: 25).write(o0)\nrender(o0)\n'

const fat = await exportFatGraph(DSL)
writeFileSync(join(__dirname, 'demo.fatgraph.json'), JSON.stringify(fat))

// Cubemap demo: a 3D noise volume rendered as a seamless cubemap (baked via renderCubemap()).
const CUBE_DSL = 'search synth3d, filter3d, render\nnoise3d(volumeSize: x64).renderCubemapSurface().write(o0)\nrender(o0)\n'
const cubeFat = await exportFatGraph(CUBE_DSL)
writeFileSync(join(__dirname, 'demo.cubemap.fatgraph.json'), JSON.stringify(cubeFat))

await build({
  entryPoints: [join(__dirname, 'procedural-texture.js')],
  bundle: true, format: 'iife', outfile: join(__dirname, 'bundle.js'),
  platform: 'browser', target: 'es2020', loader: { '.json': 'json' }, logLevel: 'info'
})

await build({
  entryPoints: [join(__dirname, 'cubemap-skybox.js')],
  bundle: true, format: 'iife', outfile: join(__dirname, 'cubemap-bundle.js'),
  platform: 'browser', target: 'es2020', loader: { '.json': 'json' }, logLevel: 'info'
})

process.stderr.write('[examples] built bundle.js + cubemap-bundle.js (+ fat graphs) — open examples/index.html or examples/cubemap.html\n')
