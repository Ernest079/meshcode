# meshcode

[Español](README.es.md)

Write 3D models as code and turn them into GLB, or turn a GLB back into code.

meshcode also ships an open benchmark that answers one question: **is it more efficient to ship game assets as files (GLB/PNG), as code, or as a hybrid of both?** AI coding agents increasingly build games with no asset files at all — every mesh, texture and effect is code. This project measures what that costs at runtime.

> Status: **early work in progress** (phase 3.5 of 8). Web app and CLI (`build`, `decompile`, `verify`, `inspect`) work; the benchmark is next.

## Planned

| Piece | What it does |
|---|---|
| `meshcode build` | Runs a three.js module (`export default (THREE) => Object3D`) and exports a `.glb`. |
| `meshcode decompile` | Reads a `.glb` and emits three.js code: detected primitives (box, sphere, cylinder) where possible, compact data otherwise. Optional `--llm` refinement with Claude. |
| Web app (PWA) | Code editor + live 3D view in the browser. Export GLB, import GLB → code. Installable as a desktop app. No server. |
| Benchmark | The same original arena shooter in three variants — `files`, `hybrid`, `code` — measured on desktop and a real Android phone. |
| Research dossier | Annotated sources on code-native vs file-based game assets: [`research/fuentes.md`](research/fuentes.md), [`research/referencias.bib`](research/referencias.bib). |

## Roadmap

- [x] 1. Repo skeleton + research dossier
- [x] 2. `meshcode build` (code → GLB)
- [x] 3. `meshcode decompile` (GLB → code) + silhouette-IoU fidelity metric (`--llm` refinement pending)
- [x] 3.5. Web app + PWA (GitHub Pages)
- [ ] 4. Benchmark game in three variants (controlled + real-asset studies)
- [ ] 5. Measurement harness (desktop + Android)
- [ ] 6. Analysis, charts, release + DOI

## Web app

**https://ernest079.github.io/meshcode/** (once GitHub Pages is enabled for the repo)

Write a model on the left, see it live on the right. **Export GLB**, **Import GLB** (or drop a `.glb` anywhere) to get its code, **Share** a link that contains the code. The footer compares the size of the code with the size of the exported GLB. Installable as a desktop app (PWA): works offline and opens `.glb` files.

Your code runs in a sandboxed iframe (opaque origin), so a shared link cannot read this site's storage or touch the page. Inside the sandbox, use the `THREE` argument; `import` statements are not available there.

```sh
pnpm dev       # http://localhost:5173
pnpm build     # → dist/
```

## CLI

```sh
pnpm meshcode build examples/torch.js -o torch.glb   # code → GLB
pnpm meshcode build examples/torch.js --meshopt      # + dedup and EXT_meshopt_compression
pnpm meshcode inspect torch.glb                      # meshes, instances, triangles, bbox
pnpm meshcode decompile torch.glb -o torch.js        # GLB → code (+ texture files), then checks fidelity
pnpm meshcode verify a.glb b.js --min 0.99           # silhouette IoU + material diff of any two models
```

`decompile` turns geometry that exactly matches a three.js primitive (box, plane, sphere, cylinder, cone) into a constructor call, and keeps anything else losslessly as base64 vertex data. Textures are written next to the module with their original bytes. Every decompile rebuilds the result and reports **silhouette IoU** (6 orthographic views, CPU-rasterized, deterministic) and a **material diff**, because IoU alone is blind to shading.

A model is an ES module whose default export receives `THREE` and returns any `Object3D`:

```js
export default (THREE) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
```

It runs in headless Google Chrome (set `MESHCODE_CHROME` to use another Chromium binary), so canvas textures, `InstancedMesh` and every three.js API behave as in the browser. See [`examples/`](examples/).

> Note: meshopt is not always smaller. On tiny meshes the extension overhead can exceed the savings (`examples/crates.js`: 2.9 KB raw → 4.5 KB meshopt).

## Development

Requires Node ≥ 22 and **pnpm** (pinned via `packageManager`; run `corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm test
```

npm is not used. pnpm is configured in [`pnpm-workspace.yaml`](pnpm-workspace.yaml) to block dependency install scripts and to skip package versions published less than 3 days ago. CI actions are pinned to commit SHAs.

## License

- Code: [MIT](LICENSE).
- Research text and benchmark data (`research/`, benchmark results): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Third-party CC0 assets keep their own licenses (listed next to them).

## Citation

See [`CITATION.cff`](CITATION.cff) or GitHub's "Cite this repository" button.
