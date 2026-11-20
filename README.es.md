# meshcode

[English](README.md)

Escribe modelos 3D como código y conviértelos en GLB, o convierte un GLB de vuelta en código.

meshcode incluye además un benchmark abierto que responde una pregunta: **¿es más eficiente distribuir los assets de un juego como archivos (GLB/PNG), como código o como un híbrido de ambos?** Los agentes de IA construyen cada vez más juegos sin ningún archivo de assets: cada malla, textura y efecto es código. Este proyecto mide cuánto cuesta eso en tiempo de ejecución.

> Estado: **trabajo temprano en curso** (fase 3.5 de 8). La app web y la CLI (`build`, `decompile`, `verify`, `inspect`) ya funcionan; el benchmark es lo siguiente.

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
- [x] 2. `meshcode build` (código → GLB)
- [x] 3. `meshcode decompile` (GLB → código) + métrica de fidelidad por IoU de siluetas (falta el refinamiento `--llm`)
- [x] 3.5. App web + PWA (GitHub Pages)
- [ ] 4. Juego de prueba en tres variantes (estudio controlado + estudio con assets reales)
- [ ] 5. Arnés de medición (escritorio + Android)
- [ ] 6. Análisis, gráficos, release + DOI

## App web

**https://ernest079.github.io/meshcode/** (cuando GitHub Pages esté activado en el repo)

Escribe un modelo a la izquierda y míralo en vivo a la derecha. **Export GLB** descarga el modelo, **Import GLB** (o soltar un `.glb` en cualquier parte) lo convierte en código y **Share** genera un enlace que contiene el código. El pie compara el tamaño del código con el del GLB exportado. Se instala como app de escritorio (PWA): funciona sin conexión y abre archivos `.glb`.

Tu código se ejecuta en un iframe aislado (origen opaco), así que un enlace compartido no puede leer el almacenamiento del sitio ni tocar la página. Dentro del sandbox usa el argumento `THREE`; ahí no están disponibles los `import`.

```sh
pnpm dev       # http://localhost:5173
pnpm build     # → dist/
```

## CLI

```sh
pnpm meshcode build examples/torch.js -o torch.glb   # código → GLB
pnpm meshcode build examples/torch.js --meshopt      # + dedup y EXT_meshopt_compression
pnpm meshcode inspect torch.glb                      # mallas, instancias, triángulos, bbox
pnpm meshcode decompile torch.glb -o torch.js        # GLB → código (+ archivos de textura) y verifica la fidelidad
pnpm meshcode verify a.glb b.js --min 0.99           # IoU de siluetas + diferencias de materiales entre dos modelos
```

`decompile` convierte la geometría que coincide exactamente con una primitiva de three.js (caja, plano, esfera, cilindro, cono) en una llamada a su constructor, y guarda el resto sin pérdida como datos de vértices en base64. Las texturas se escriben junto al módulo con sus bytes originales. Cada decompilación reconstruye el resultado y reporta el **IoU de siluetas** (6 vistas ortográficas, rasterizadas en CPU, deterministas) y las **diferencias de materiales**, porque el IoU por sí solo no detecta errores de sombreado.

Un modelo es un módulo ES cuyo export por defecto recibe `THREE` y devuelve cualquier `Object3D`:

```js
export default (THREE) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
```

Se ejecuta en Google Chrome headless (con `MESHCODE_CHROME` puedes usar otro binario de Chromium), así que las texturas de canvas, `InstancedMesh` y toda la API de three.js funcionan igual que en el navegador. Ver [`examples/`](examples/).

> Nota: meshopt no siempre reduce el tamaño. En mallas muy pequeñas lo que añade la extensión supera al ahorro (`examples/crates.js`: 2,9 KB raw → 4,5 KB con meshopt).

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
