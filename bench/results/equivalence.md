# Visual equivalence gate

Reference: `code` variant. 960×540, dpr 1, headless Chrome. Instants: 3, 6.3, 11.7, 19.2 s. Tolerance: ±8 levels per channel.
Pass: scene only PSNR ≥ 35 dB and ≥ 99 % within tolerance; with effects PSNR ≥ 30 dB and ≥ 97 %.

| variant | effects | t (s) | PSNR | pixels within ±8 | mean abs diff | pass |
|---|---|---:|---:|---:|---:|---|
| code +1 frame | no | 6.3 | 27.2 dB | 87.43 % | 3.648 | fails, as it must |
| code +1 frame | yes | 6.3 | 25.1 dB | 86.19 % | 4.177 | fails, as it must |
| files-etc1s | no | 3 | 36.3 dB | 92.67 % | 1.960 | ❌ |
| files-etc1s | no | 6.3 | 36.3 dB | 92.41 % | 1.975 | ❌ |
| files-etc1s | no | 11.7 | 37.5 dB | 93.93 % | 1.661 | ❌ |
| files-etc1s | no | 19.2 | 37.9 dB | 94.65 % | 1.641 | ❌ |
| files-etc1s | yes | 3 | 36.5 dB | 92.74 % | 1.937 | ❌ |
| files-etc1s | yes | 6.3 | 36.4 dB | 92.51 % | 1.960 | ❌ |
| files-etc1s | yes | 11.7 | 37.5 dB | 93.87 % | 1.666 | ❌ |
| files-etc1s | yes | 19.2 | 37.9 dB | 94.53 % | 1.639 | ❌ |
| files-png | no | 3 | 56.0 dB | 99.97 % | 0.021 | ✅ |
| files-png | no | 6.3 | 53.2 dB | 99.94 % | 0.026 | ✅ |
| files-png | no | 11.7 | 58.3 dB | 99.98 % | 0.013 | ✅ |
| files-png | no | 19.2 | 55.7 dB | 99.97 % | 0.016 | ✅ |
| files-png | yes | 3 | 55.3 dB | 99.97 % | 0.036 | ✅ |
| files-png | yes | 6.3 | 52.9 dB | 99.94 % | 0.045 | ✅ |
| files-png | yes | 11.7 | 56.5 dB | 99.97 % | 0.035 | ✅ |
| files-png | yes | 19.2 | 54.2 dB | 99.92 % | 0.037 | ✅ |
| files-uastc | no | 3 | 45.8 dB | 99.52 % | 0.615 | ✅ |
| files-uastc | no | 6.3 | 45.4 dB | 99.48 % | 0.620 | ✅ |
| files-uastc | no | 11.7 | 47.1 dB | 99.69 % | 0.508 | ✅ |
| files-uastc | no | 19.2 | 47.4 dB | 99.75 % | 0.498 | ✅ |
| files-uastc | yes | 3 | 45.8 dB | 99.55 % | 0.614 | ✅ |
| files-uastc | yes | 6.3 | 45.5 dB | 99.54 % | 0.622 | ✅ |
| files-uastc | yes | 11.7 | 47.1 dB | 99.69 % | 0.517 | ✅ |
| files-uastc | yes | 19.2 | 47.2 dB | 99.70 % | 0.507 | ✅ |
| files-webp | no | 3 | 50.3 dB | 99.90 % | 0.342 | ✅ |
| files-webp | no | 6.3 | 49.6 dB | 99.90 % | 0.335 | ✅ |
| files-webp | no | 11.7 | 52.0 dB | 99.97 % | 0.275 | ✅ |
| files-webp | no | 19.2 | 51.4 dB | 99.97 % | 0.280 | ✅ |
| files-webp | yes | 3 | 49.8 dB | 99.89 % | 0.360 | ✅ |
| files-webp | yes | 6.3 | 48.9 dB | 99.87 % | 0.373 | ✅ |
| files-webp | yes | 11.7 | 50.9 dB | 99.91 % | 0.308 | ✅ |
| files-webp | yes | 19.2 | 50.5 dB | 99.90 % | 0.306 | ✅ |
| hybrid-etc1s | no | 3 | 36.3 dB | 92.67 % | 1.960 | ❌ |
| hybrid-etc1s | no | 6.3 | 36.3 dB | 92.41 % | 1.975 | ❌ |
| hybrid-etc1s | no | 11.7 | 37.5 dB | 93.93 % | 1.661 | ❌ |
| hybrid-etc1s | no | 19.2 | 37.9 dB | 94.65 % | 1.641 | ❌ |
| hybrid-etc1s | yes | 3 | 36.5 dB | 92.97 % | 1.899 | ❌ |
| hybrid-etc1s | yes | 6.3 | 36.6 dB | 93.04 % | 1.880 | ❌ |
| hybrid-etc1s | yes | 11.7 | 37.7 dB | 94.29 % | 1.598 | ❌ |
| hybrid-etc1s | yes | 19.2 | 38.0 dB | 94.84 % | 1.592 | ❌ |
| hybrid-png | no | 3 | 56.0 dB | 99.97 % | 0.021 | ✅ |
| hybrid-png | no | 6.3 | 53.2 dB | 99.94 % | 0.026 | ✅ |
| hybrid-png | no | 11.7 | 58.3 dB | 99.98 % | 0.013 | ✅ |
| hybrid-png | no | 19.2 | 55.7 dB | 99.97 % | 0.016 | ✅ |
| hybrid-png | yes | 3 | 56.0 dB | 99.97 % | 0.020 | ✅ |
| hybrid-png | yes | 6.3 | 53.3 dB | 99.94 % | 0.025 | ✅ |
| hybrid-png | yes | 11.7 | 58.3 dB | 99.98 % | 0.012 | ✅ |
| hybrid-png | yes | 19.2 | 55.8 dB | 99.97 % | 0.016 | ✅ |
| hybrid-uastc | no | 3 | 45.8 dB | 99.52 % | 0.615 | ✅ |
| hybrid-uastc | no | 6.3 | 45.4 dB | 99.48 % | 0.620 | ✅ |
| hybrid-uastc | no | 11.7 | 47.1 dB | 99.69 % | 0.508 | ✅ |
| hybrid-uastc | no | 19.2 | 47.4 dB | 99.75 % | 0.498 | ✅ |
| hybrid-uastc | yes | 3 | 45.9 dB | 99.55 % | 0.597 | ✅ |
| hybrid-uastc | yes | 6.3 | 45.7 dB | 99.54 % | 0.594 | ✅ |
| hybrid-uastc | yes | 11.7 | 47.3 dB | 99.71 % | 0.489 | ✅ |
| hybrid-uastc | yes | 19.2 | 47.5 dB | 99.76 % | 0.483 | ✅ |
| hybrid-webp | no | 3 | 50.3 dB | 99.90 % | 0.342 | ✅ |
| hybrid-webp | no | 6.3 | 49.6 dB | 99.90 % | 0.335 | ✅ |
| hybrid-webp | no | 11.7 | 52.0 dB | 99.97 % | 0.275 | ✅ |
| hybrid-webp | no | 19.2 | 51.4 dB | 99.97 % | 0.280 | ✅ |
| hybrid-webp | yes | 3 | 50.3 dB | 99.90 % | 0.333 | ✅ |
| hybrid-webp | yes | 6.3 | 49.8 dB | 99.90 % | 0.324 | ✅ |
| hybrid-webp | yes | 11.7 | 52.2 dB | 99.97 % | 0.265 | ✅ |
| hybrid-webp | yes | 19.2 | 51.5 dB | 99.97 % | 0.271 | ✅ |

`code +1 frame` is a negative control: the same variant 1/60 s later. It must fail, which shows the gate can tell apart
two renders that differ by one frame of motion.

**Admitted** (measured in phase 5): code, hybrid-png, hybrid-webp, hybrid-uastc, files-png, files-webp, files-uastc.
**Excluded** (fail the gate): files-etc1s, hybrid-etc1s.
