# meshcode bench

One original arena shooter in three variants that differ **only in where the assets come from**. It backs the study
*files vs hybrid vs code* (research notes: [`research/bitacora.md`](../research/bitacora.md), in Spanish).

| | **code** | **hybrid** | **files** |
|---|---|---|---|
| models + textures | built at runtime (three.js + canvas) | GLB (meshopt); PNG, WebP or KTX2 textures | GLB (meshopt); PNG, WebP or KTX2 textures |
| effects | shaders | shaders | flipbook + sprite images |
| level layout | seeded generator | seeded generator | `layout.json` |

The code variant is the single source of truth: `build.mjs` bakes every file the other variants download from it with
meshcode, so geometry, materials, layout and effects match by construction. The world is an analytic function of time:
runs are deterministic and frame-rate independent, and any instant renders exactly (`?freeze=t`).

```sh
pnpm bench:build    # bake assets (GLB png/webp/uastc/etc1s, flipbook, sprite, layout) + build the 3 pages → bench/dist
pnpm bench:check    # visual equivalence gate vs code (+ negative control) → results/equivalence.md (admitted / excluded), figures
pnpm bench:static   # bytes, GPU memory, draw calls, generation time, preliminary load → results/static.md
```

Page parameters: `?tex=png|webp|uastc|etc1s` (files, hybrid; the last two are KTX2 / Basis Universal), `?freeze=t` (render one instant; `__bench.read(t)` returns RGBA),
`?novfx`, `?seconds=N` (timed run; frame times in `__bench.frames`), `?dpr=1`. Phases are marked with
`performance.mark('mc:…')` and summarised in `window.__bench`.

```
game/src/models/   arena, crate, barrel, drone, bolt   (meshcode model modules)
game/src/vfx.js    effects in both forms + their bakers
game/src/game.js   the game, shared by all variants
game/src/variants/ code.js, hybrid.js, files.js (+ assets.js: GLB / image loading)
```

## Vendored: Basis Universal encoder

`vendor/basis/` holds the official prebuilt WASM encoder of [Basis Universal](https://github.com/BinomialLLC/basis_universal)
(Apache-2.0, see `vendor/basis/LICENSE`), release **v2_50**, files `webgl/encoder/build/basis_encoder.{js,wasm}`. `build.mjs`
runs it in Node to write the KTX2 textures; nothing is installed system-wide. Decoding uses the transcoder that ships with
three.js (bundled by Vite with `KTX2Loader`). SHA-256:

```
d225ce1e7012609bcfbe338351c8778d95eb1c19d404314d513b2b2df94a6ffb  basis_encoder.js
48d4e39ccaa1e290a17d00c13b353a728227bb439108d5e6c944fe6ab80552db  basis_encoder.wasm
```
