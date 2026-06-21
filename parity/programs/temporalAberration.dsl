search filter, synth

noise(
  speed: 40,
  colorMode: mono,
  ridges: true
)
  .temporalAberration()
  .write(o0)
render(o0)
