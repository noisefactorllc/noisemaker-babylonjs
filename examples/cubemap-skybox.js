// Example: a Noisemaker 3D volume BAKED into a cubemap and used as a Babylon skybox + reflection.
//
// Built by examples/build.mjs (which generates demo.cubemap.fatgraph.json from a cubemap DSL via
// the reference compiler). Demonstrates NoisemakerRenderer.renderCubemap(): it drives the reused
// Pipeline.renderCubemap() 6-face loop (byte-identical to the reference) and bakes the faces into a
// Babylon-native cube InternalTexture — the parallel of the HLSL port's Unity-native cubemap. Here
// that cube texture is dropped onto a skybox and a reflective sphere.

import { Engine } from '@babylonjs/core/Engines/engine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js'
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js'
import '@babylonjs/core/Shaders/postprocess.vertex.js' // EffectRenderer's default vertex
import { Pipeline } from '../../noisemaker/shaders/src/runtime/pipeline.js'
import { NoisemakerRenderer } from '../src/runtime/renderer.js'
import cubeFat from './demo.cubemap.fatgraph.json'

async function main () {
  const canvas = document.getElementById('app')
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false }, true)
  const scene = new Scene(engine)
  const cam = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 2.4, 6, Vector3.Zero(), scene)
  cam.attachControl(canvas, true)
  cam.minZ = 0.1

  // Bake the noise volume into a cubemap (6 faces → a Babylon cube InternalTexture).
  const nm = new NoisemakerRenderer(engine, { Pipeline, size: 256 })
  await nm.loadGraph(cubeFat)
  const { cubeTexture } = await nm.renderCubemap({ size: 256, time: 0.25 })

  // Two scene CubeTextures wrapping the SAME baked cube InternalTexture — one in SKYBOX_MODE for the
  // backdrop, one in CUBIC_MODE for reflections. (Assign `_texture` directly; don't `clone()` — clone
  // allocates a fresh empty texture and drops the manually-wired InternalTexture.)
  const envSky = new CubeTexture('', scene); envSky._texture = cubeTexture; envSky.coordinatesMode = Texture.SKYBOX_MODE
  const envRefl = new CubeTexture('', scene); envRefl._texture = cubeTexture; envRefl.coordinatesMode = Texture.CUBIC_MODE

  // Skybox: a large inverted box showing the cubemap from the inside.
  const sky = MeshBuilder.CreateBox('sky', { size: 1000 }, scene)
  const skyMat = new StandardMaterial('skyMat', scene)
  skyMat.backFaceCulling = false
  skyMat.disableLighting = true
  skyMat.reflectionTexture = envSky
  skyMat.diffuseColor = new Color3(0, 0, 0)
  skyMat.specularColor = new Color3(0, 0, 0)
  sky.material = skyMat
  sky.infiniteDistance = true

  // Reflective sphere using the same cubemap as a cubic reflection.
  const sphere = MeshBuilder.CreateSphere('s', { diameter: 2.5, segments: 48 }, scene)
  const sMat = new StandardMaterial('sMat', scene)
  sMat.diffuseColor = new Color3(0.05, 0.05, 0.07)
  sMat.reflectionTexture = envRefl
  sMat.specularColor = new Color3(1, 1, 1)
  sphere.material = sMat

  engine.runRenderLoop(() => { scene.render() })
  window.addEventListener('resize', () => engine.resize())
}

main()
