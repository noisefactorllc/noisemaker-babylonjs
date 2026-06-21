search synth

noise(seed: 1, scaleX: 20, scaleY: 20, octaves: 2, colorMode: 1, speed: 0).write(o1)
noise(seed: 9, scaleX: 6, scaleY: 6, octaves: 1, colorMode: 1, speed: 0).write(o2)
remap(
  zoneCount: 2,
  bgColor: #336699,
  bgAlpha: 1,
  smoothEdge: 0.04,
  zone0_tex: read(o1),
  zone0_count: 4,
  zone0_alpha: 1,
  zone0_v0: [0.05, 0.05, 0.5, 0.05],
  zone0_v1: [0.5, 0.95, 0.05, 0.95],
  zone1_tex: read(o2),
  zone1_count: 3,
  zone1_alpha: 1,
  zone1_v0: [0.55, 0.1, 0.95, 0.5],
  zone1_v1: [0.55, 0.9, 0.0, 0.0]
).write(o0)
render(o0)
