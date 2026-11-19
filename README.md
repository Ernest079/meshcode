# meshcode

[Español](README.es.md)

Write 3D models as code and turn them into GLB, or turn a GLB back into code.

meshcode also ships an open benchmark that answers one question: **is it more efficient to ship game assets as files (GLB/PNG), as code, or as a hybrid of both?** AI coding agents increasingly build games with no asset files at all — every mesh, texture and effect is code. This project measures what that costs at runtime.

> Status: **early work in progress** (phase 1 of 8). Nothing is usable yet.

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
- [ ] 2. `meshcode build` (code → GLB)
- [ ] 3. `meshcode decompile` (GLB → code) + silhouette-IoU fidelity metric
- [ ] 3.5. Web app + PWA (GitHub Pages)
- [ ] 4. Benchmark game in three variants (controlled + real-asset studies)
- [ ] 5. Measurement harness (desktop + Android)
- [ ] 6. Analysis, charts, release + DOI

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
