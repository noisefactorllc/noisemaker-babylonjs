search mixer, synth

noise(
  type: constant,
  octaves: 4,
  ridges: true,
  loopScale: 100,
  speed: 100
)
  .write(o0)

solid(color: #006d4c)
  .write(o1)

perlin(ridges: true)
  .write(o2)

gradient(
  type: noiseGradient,
  color1: #ffffffff,
  color2: #a9a9a9ff,
  color3: #515151ff,
  color4: #000000ff,
  colorCount: 3
)
  .write(o3)

mashup(
  source: read(o3),
  layers: 3,
  smoothness: 0.22,
  layer0_tex: read(o0),
  layer1_tex: read(o1),
  layer2_tex: read(o2)
)
  .write(o4)
render(o0)
