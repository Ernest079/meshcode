# meshcode

[English](README.md)

Escribe modelos 3D como código y conviértelos en GLB, o convierte un GLB de vuelta en código.

meshcode incluye además un benchmark abierto que responde una pregunta: **¿es más eficiente distribuir los assets de un juego como archivos (GLB/PNG), como código o como un híbrido de ambos?** Los agentes de IA construyen cada vez más juegos sin ningún archivo de assets: cada malla, textura y efecto es código. Este proyecto mide cuánto cuesta eso en tiempo de ejecución.

> Estado: **trabajo temprano en curso** (fase 1 de 8). Todavía no hay nada usable.

## Planeado

| Pieza | Qué hace |
|---|---|
| `meshcode build` | Ejecuta un módulo de three.js (`export default (THREE) => Object3D`) y exporta un `.glb`. |
| `meshcode decompile` | Lee un `.glb` y genera código three.js: primitivas detectadas (caja, esfera, cilindro) cuando es posible y datos compactos en otro caso. Refinamiento opcional con Claude (`--llm`). |
| App web (PWA) | Editor de código + vista 3D en vivo en el navegador. Exporta GLB e importa GLB → código. Instalable como app de escritorio. Sin servidor. |
| Benchmark | El mismo shooter de arena original en tres variantes (`files`, `hybrid`, `code`), medido en escritorio y en un Android real. |
| Dossier de investigación | Fuentes anotadas sobre assets como código frente a assets como archivo: [`research/fuentes.md`](research/fuentes.md), [`research/referencias.bib`](research/referencias.bib). |

## Hoja de ruta

- [x] 1. Esqueleto del repo + dossier de investigación
- [ ] 2. `meshcode build` (código → GLB)
- [ ] 3. `meshcode decompile` (GLB → código) + métrica de fidelidad por IoU de siluetas
- [ ] 3.5. App web + PWA (GitHub Pages)
- [ ] 4. Juego de prueba en tres variantes (estudio controlado + estudio con assets reales)
- [ ] 5. Arnés de medición (escritorio + Android)
- [ ] 6. Análisis, gráficos, release + DOI

## Desarrollo

Requiere Node ≥ 22 y **pnpm** (versión fijada en `packageManager`; ejecuta `corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm test
```

No se usa npm. pnpm está configurado en [`pnpm-workspace.yaml`](pnpm-workspace.yaml) para bloquear los scripts de instalación de las dependencias y para ignorar versiones publicadas hace menos de 3 días. Las actions de CI están fijadas por SHA de commit.

## Licencia

- Código: [MIT](LICENSE).
- Texto de investigación y datos del benchmark (`research/`, resultados): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Los assets CC0 de terceros conservan su propia licencia (indicada junto a ellos).

## Cita

Ver [`CITATION.cff`](CITATION.cff) o el botón "Cite this repository" de GitHub.
