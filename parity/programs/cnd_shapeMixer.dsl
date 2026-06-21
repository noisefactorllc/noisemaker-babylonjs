search synth, classicNoisedeck
noise(seed: 1, scaleX: 50, scaleY: 50).write(o0)
gradient(seed: 2).shapeMixer(tex: o0).write(o1)
render(o1)
