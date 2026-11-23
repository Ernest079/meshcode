# Visual equivalence gate

Reference: `real-glb-png`. 960×540, dpr 1, headless Chrome. Instants: 3, 6.3, 11.7, 19.2 s. Tolerance: ±8 levels per channel.
Pass: scene only PSNR ≥ 35 dB and ≥ 99 % within tolerance; with effects PSNR ≥ 30 dB and ≥ 97 %.

| variant | effects | t (s) | PSNR | pixels within ±8 | mean abs diff | pass |
|---|---|---:|---:|---:|---:|---|
| real-code | no | 3 | 30.5 dB | 92.83 % | 1.739 | report only (would fail) |
| real-code | no | 6.3 | 30.6 dB | 92.49 % | 1.799 | report only (would fail) |
| real-code | no | 11.7 | 31.3 dB | 93.35 % | 1.549 | report only (would fail) |
| real-code | no | 19.2 | 31.7 dB | 93.92 % | 1.410 | report only (would fail) |
| real-code | yes | 3 | 30.6 dB | 92.96 % | 1.712 | report only (would fail) |
| real-code | yes | 6.3 | 30.8 dB | 92.84 % | 1.714 | report only (would fail) |
| real-code | yes | 11.7 | 31.6 dB | 93.71 % | 1.475 | report only (would fail) |
| real-code | yes | 19.2 | 31.8 dB | 94.07 % | 1.377 | report only (would fail) |
| real-decompiled | no | 3 | 52.9 dB | 99.82 % | 0.058 | ✅ |
| real-decompiled | no | 6.3 | 52.2 dB | 99.80 % | 0.062 | ✅ |
| real-decompiled | no | 11.7 | 54.0 dB | 99.88 % | 0.044 | ✅ |
| real-decompiled | no | 19.2 | 55.0 dB | 99.91 % | 0.040 | ✅ |
| real-decompiled | yes | 3 | 53.0 dB | 99.82 % | 0.056 | ✅ |
| real-decompiled | yes | 6.3 | 52.5 dB | 99.81 % | 0.058 | ✅ |
| real-decompiled | yes | 11.7 | 54.2 dB | 99.88 % | 0.042 | ✅ |
| real-decompiled | yes | 19.2 | 55.1 dB | 99.91 % | 0.039 | ✅ |
| real-glb-png +1 frame | no | 6.3 | 28.1 dB | 88.69 % | 3.294 | fails, as it must |
| real-glb-png +1 frame | yes | 6.3 | 25.7 dB | 87.40 % | 3.822 | fails, as it must |
| real-glb-png128 | no | 3 | 57.0 dB | 100.00 % | 0.115 | ✅ |
| real-glb-png128 | no | 6.3 | 57.1 dB | 100.00 % | 0.114 | ✅ |
| real-glb-png128 | no | 11.7 | 58.1 dB | 100.00 % | 0.092 | ✅ |
| real-glb-png128 | no | 19.2 | 59.0 dB | 100.00 % | 0.077 | ✅ |
| real-glb-png128 | yes | 3 | 57.1 dB | 100.00 % | 0.113 | ✅ |
| real-glb-png128 | yes | 6.3 | 57.3 dB | 100.00 % | 0.108 | ✅ |
| real-glb-png128 | yes | 11.7 | 58.3 dB | 100.00 % | 0.087 | ✅ |
| real-glb-png128 | yes | 19.2 | 59.1 dB | 100.00 % | 0.075 | ✅ |
| real-glb-uastc | no | 3 | 49.6 dB | 99.51 % | 0.157 | ✅ |
| real-glb-uastc | no | 6.3 | 49.7 dB | 99.50 % | 0.158 | ✅ |
| real-glb-uastc | no | 11.7 | 51.7 dB | 99.72 % | 0.122 | ✅ |
| real-glb-uastc | no | 19.2 | 52.6 dB | 99.83 % | 0.108 | ✅ |
| real-glb-uastc | yes | 3 | 50.1 dB | 99.60 % | 0.149 | ✅ |
| real-glb-uastc | yes | 6.3 | 50.4 dB | 99.60 % | 0.144 | ✅ |
| real-glb-uastc | yes | 11.7 | 52.0 dB | 99.74 % | 0.114 | ✅ |
| real-glb-uastc | yes | 19.2 | 52.9 dB | 99.85 % | 0.104 | ✅ |

`real-glb-png +1 frame` is a negative control: the reference 1/60 s later. It must fail, which shows the gate can tell apart
two renders that differ by one frame of motion.

Report only: real-code — a hand-written imitation cannot match pixel for pixel; it is gated per model (bench/real/gate.mjs).

**Admitted** (measured in phase 5): real-glb-png, real-glb-png128, real-glb-uastc, real-decompiled, real-code.

