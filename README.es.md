# meshcode

[English](README.md)

Escribe modelos 3D como código y conviértelos en GLB, o convierte un GLB de vuelta en código.

meshcode incluye además un benchmark abierto que responde una pregunta: **¿es más eficiente distribuir los assets de un juego como archivos (GLB/PNG), como código o como un híbrido de ambos?** Los agentes de IA construyen cada vez más juegos sin ningún archivo de assets: cada malla, textura y efecto es código. Este proyecto mide cuánto cuesta eso en tiempo de ejecución.

> Estado: **trabajo temprano en curso** (fase 3.8). La app web (3D + 2D), la exportación a motores (Godot, Unity) y la CLI ya funcionan; la IA opcional es lo siguiente.

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
- [x] 3.6. Tema claro/oscuro + ejemplos detallados
- [x] 3.7. Modo 2D: imágenes desde código (Canvas, SVG, HTML/CSS → PNG/JPG/WebP)
- [x] 3.8. Exportar a motores: Godot (GDScript), Unity (C#, experimental); Unreal vía GLB
- [ ] 3.9. IA opcional: modelos locales o tu propia API key (generar, reparar, refinar importaciones)
- [ ] 3.10. GIF de demostración en el README
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

### Modo 2D: imágenes desde código

Cambia a **2D** para convertir código en **PNG / JPG / WebP** (y conservar el SVG como SVG). Hay tres tipos de fuente, que se detectan automáticamente:

| Fuente | Contrato |
|---|---|
| Canvas (JS) | `export default (ctx, { width, height, frame, frames }) => { … }` más los opcionales `export const size = [w, h]`, `frames = N` (sprite sheet), `columns` y `fps` |
| SVG | markup SVG normal (tamaño desde `width`/`height` o `viewBox`) |
| HTML + CSS | markup con un bloque `<style>`; el tamaño va en un comentario como `<!-- size: 512x256 -->`. Se renderiza con SVG `foreignObject`: usa fuentes del sistema e imágenes embebidas (`data:`). Funciona en Chromium y Firefox, no en Safari. |

Los módulos canvas con varios frames generan un **sprite sheet** (frames de izquierda a derecha y luego hacia abajo), y la vista previa los reproduce; haz clic en ella para ver el sheet completo.

## Ejemplos

Modelos originales en [`examples/`](examples/), cada uno muestra una técnica (todos se cargan desde el menú **Examples** de la app web):

| Ejemplo | Técnicas |
|---|---|
| `torch.js` | perfiles con LatheGeometry, anillos torus, texturas de canvas, llama en capas sin iluminación, PointLight, brasas instanciadas |
| `chest.js` | tapa de medio cilindro sobre un pivote (lista para animar), arcos torus, pila de 90 monedas con InstancedMesh |
| `barrel.js` | una sola función de perfil define el cuerpo torneado *y* los aros, textura de duelas que se repite |
| `forest.js` | PRNG con semilla (cambia `SEED`), muestreo por rechazo, terreno desplazado, 265 instancias en 5 draw calls |
| `spaceship.js` | fuselaje torneado, alas extruidas desde un `Shape` 2D, brillo de motores sin iluminación (frente = −Z) |
| `dungeon-kit.js` | piezas modulares en una grilla de 2 m, arco hecho con un `Shape` con hueco, UVs escaladas a metros |

Cada ejemplo se verifica en CI: GLB válido (validador de Khronos) y `decompile` lo reconstruye con IoU de silueta 1,0 y materiales idénticos.

Ejemplos 2D en [`examples/2d/`](examples/2d/):

| Ejemplo | Técnicas |
|---|---|
| `adventurer-walk.js` | pixel art a 16×16, contorno calculado desde el canal alfa, escalado ×4 sin suavizado, sheet de caminata de 8 frames |
| `cobblestone-texture.js` | piedras Voronoi sin costuras (las distancias dan la vuelta por los bordes), mortero y grano |
| `parallax-layers.js` | 3 capas (cielo, montañas, colinas) como frames; crestas periódicas para que cada capa haga scroll sin cortes |
| `item-icons.svg` | tres íconos que comparten gradientes SVG |
| `ui-kit.html` | botones y barras de vida y maná solo con gradientes y sombras CSS |

## Motores de juego

Exporta la **escena resultante** de un modelo como código nativo del motor. No es un traductor de JavaScript: el modelo se ejecuta primero, así que los bucles, el azar y las texturas de canvas ya están resueltos. En la app web: **Export → Godot .gd / Unity .cs**. Desde la CLI:

```sh
pnpm meshcode export examples/chest.js --to godot          # → chest.gd
pnpm meshcode export examples/chest.js --to unity          # → ChestModel.cs
pnpm meshcode export model.glb --to godot -o Model.gd      # también acepta .glb
```

| Motor | Salida | Cómo se usa | Estado |
|---|---|---|---|
| **Godot 4** | GDScript (`@tool extends Node3D`) | se adjunta a un `Node3D`; el modelo se construye bajo un hijo llamado `Model`, también en vivo en el editor | **verificado**: cada ejemplo se ejecuta en Godot 4.6.3 headless con las mismas mallas, instancias y AABB en el mundo que three.js |
| **Unity** | `MonoBehaviour` en C# | se agrega a un GameObject vacío; se construye en `Awake()`; pipelines Built-in y URP | experimental (no se compila en CI); Z espejado a mano izquierda, sentido de las caras verificado por tests |
| **Unreal 5** | — | exporta el **GLB** e impórtalo (importador glTF Interchange, nativo desde UE 5.1) | vía GLB |

Godot conserva las primitivas editables (`BoxMesh`, `CylinderMesh`, `SphereMesh`, `PlaneMesh`) cuando la malla no tiene textura; lo demás va como datos de vértices exactos en un `ArrayMesh`, y los `InstancedMesh` pasan a `MultiMesh`. La intensidad de las luces usa unidades distintas en cada motor: ajústala después de importar.

## CLI

```sh
pnpm meshcode build examples/torch.js -o torch.glb   # código → GLB
pnpm meshcode build examples/torch.js --meshopt      # + dedup y EXT_meshopt_compression
pnpm meshcode inspect torch.glb                      # mallas, instancias, triángulos, bbox
pnpm meshcode decompile torch.glb -o torch.js        # GLB → código (+ archivos de textura) y verifica la fidelidad
pnpm meshcode verify a.glb b.js --min 0.99           # IoU de siluetas + diferencias de materiales entre dos modelos
pnpm meshcode build examples/2d/adventurer-walk.js -o walk.png   # 2D: la extensión de salida decide PNG / JPG / WebP
pnpm meshcode build examples/2d/item-icons.svg                    # entra SVG o HTML → sale PNG
```

`decompile` convierte la geometría que coincide exactamente con una primitiva de three.js (caja, plano, esfera, cilindro, cono) en una llamada a su constructor, y guarda el resto sin pérdida como datos de vértices en base64. Las texturas se escriben junto al módulo con sus bytes originales. Cada decompilación reconstruye el resultado y reporta el **IoU de siluetas** (6 vistas ortográficas, rasterizadas en CPU, deterministas) y las **diferencias de materiales**, porque el IoU por sí solo no detecta errores de sombreado.

Un modelo es un módulo ES cuyo export por defecto recibe `THREE` y devuelve cualquier `Object3D`:

```js
export default (THREE) => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
```

Se ejecuta en Google Chrome headless (con `MESHCODE_CHROME` puedes usar otro binario de Chromium), así que las texturas de canvas, `InstancedMesh` y toda la API de three.js funcionan igual que en el navegador. Ver [`examples/`](examples/).

> Nota: meshopt no siempre reduce el tamaño. En mallas muy pequeñas lo que añade la extensión supera al ahorro (`test/fixtures/instanced.js`: 2,9 KB raw → 4,5 KB con meshopt).

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
