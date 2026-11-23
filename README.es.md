# meshcode

[English](README.md)

Escribe modelos 3D como código y conviértelos en GLB, o convierte un GLB de vuelta en código.

![App web de meshcode: una antorcha de pared, un bosque procedural que se regenera al cambiar su semilla, una nave, y luego el modo 2D con un ciclo de caminata en pixel art, íconos SVG y una interfaz de juego en HTML/CSS](docs/demo.gif)

<sub>Grabado con `pnpm demo:gif` (Chrome headless + ImageMagick).</sub>

meshcode incluye además un benchmark abierto que responde una pregunta: **¿es más eficiente distribuir los assets de un juego como archivos (GLB/PNG), como código o como un híbrido de ambos?** Los agentes de IA construyen cada vez más juegos sin ningún archivo de assets: cada malla, textura y efecto es código. Este proyecto mide cuánto cuesta eso en tiempo de ejecución.

> Estado: **trabajo temprano en curso** (fase 3.11). La app web (3D + 2D), la exportación a motores (Godot, Unity), la IA opcional y la CLI ya funcionan; lo siguiente es el juego de prueba.

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
- [x] 3. `meshcode decompile` (GLB → código) + métrica de fidelidad por IoU de siluetas (+ refinamiento `--llm`, 3.9)
- [x] 3.5. App web + PWA (GitHub Pages)
- [x] 3.6. Tema claro/oscuro + ejemplos detallados
- [x] 3.7. Modo 2D: imágenes desde código (Canvas, SVG, HTML/CSS → PNG/JPG/WebP)
- [x] 3.8. Exportar a motores: Godot (GDScript), Unity (C#, experimental); Unreal vía GLB
- [x] 3.9. IA opcional: modelos locales o tu propia API key (generar, reparar, refinar importaciones)
- [x] 3.10. GIF de demostración en el README
- [x] 3.11. Modelo ↔ código: clic en una pieza para seleccionar su código, cursor para resaltar piezas
- [x] 3.12. Animación 3D desde código (piezas rígidas → keyframes en el GLB)
- [ ] 4. Juego de prueba en tres variantes (estudio controlado + estudio con assets reales)
- [ ] 5. Arnés de medición (escritorio + Android)
- [ ] 6. Análisis, gráficos, release + DOI

## App web

**https://ernest079.github.io/meshcode/** (cuando GitHub Pages esté activado en el repo)

Escribe un modelo a la izquierda y míralo en vivo a la derecha. **Export GLB** descarga el modelo, **Import GLB** (o soltar un `.glb` en cualquier parte) lo convierte en código y **Share** genera un enlace que contiene el código. El pie compara el tamaño del código con el del GLB exportado. Se instala como app de escritorio (PWA): funciona sin conexión y abre archivos `.glb`.

**Modelo ↔ código.** Haz clic en una pieza del visor: se selecciona el código que la creó (la llamada `part('wing', …)`, no el helper por el que pasa) y la pieza se marca con un contorno. Mueve el cursor en el editor: se marcan las piezas que crea ese bloque. Funciona también con GLB importados y justo después de editar, antes de volver a ejecutar. Una `InstancedMesh` selecciona su propio bloque (con el número de instancia en la barra de estado); las piezas creadas en un mismo bucle comparten línea.

Tu código se ejecuta en un iframe aislado (origen opaco), así que un enlace compartido no puede leer el almacenamiento del sitio ni tocar la página. Dentro del sandbox usa el argumento `THREE`; ahí no están disponibles los `import`.

```sh
pnpm dev       # http://localhost:5173
pnpm build     # → dist/
```

### Animación: piezas que se mueven desde código

Añade un export `animate` para mover, rotar o escalar piezas en el tiempo. meshcode lo muestrea (`fps`, 30 por defecto) en keyframes: el visor los reproduce en bucle y **Export GLB** (y `meshcode build`) los escribe como animación glTF, que Blender, Godot, Unity y Unreal importan.

```js
export const duration = 3; // segundos
export const animate = (root, t) => {
  // valores absolutos a partir de t (sin `+=`); busca las piezas por nombre. t = 0 es la pose de reposo.
  root.getObjectByName('lid_hinge').rotation.x = -1.1 * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / duration));
};
export default (THREE) => { /* … */ };
```

Solo se animan posición/rotación/escala de los nodos (sin esqueletos, ni por instancia, ni materiales). Los scripts de Godot/Unity no llevan la animación: exporta GLB para eso. Las animaciones de un GLB importado aún no se convierten en código.

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
| `chest.js` | tapa de medio cilindro sobre un pivote, animada con `animate` (se abre y se cierra), arcos torus, pila de 90 monedas con InstancedMesh |
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

## IA (opcional)

meshcode funciona completo sin IA. Si la quieres, pulsa **AI** en la app web y abre **Settings**:

| Proveedor | Ejemplos | Clave |
|---|---|---|
| Compatible con OpenAI | Ollama, LM Studio, servidor de llama.cpp, OpenAI, OpenRouter, Groq | ninguna para servidores locales |
| Anthropic | Claude (por defecto `claude-opus-5-5`), con el SDK oficial | tu propia API key |

- **Generate**: describe un modelo (modo 3D) o una imagen (modo 2D); el código llega en streaming al editor.
- **Edit**: describe un cambio al código actual; recibes un diff para aceptar o rechazar (por bloque o completo).
- **Reparación**: cada respuesta se ejecuta en el sandbox; los errores o un resultado vacío vuelven al modelo, hasta 3 veces.
- **Visual critique** (modelos con visión): el primer resultado que funciona se renderiza (cuatro vistas, o la imagen) y se le muestra al modelo una vez.
- **Refine import**: tras importar un GLB, reescribe el código generado como código legible. Los datos grandes de vértices e imágenes se sustituyen por marcadores antes de que el modelo los vea. La reescritura **solo se conserva si** las siluetas siguen coincidiendo con el GLB desde 6 vistas (IoU ≥ 0,95) y los materiales son idénticos.

Privacidad: las peticiones van directo de tu navegador al proveedor, sin ningún servidor de meshcode en medio. La clave se queda en la página de la app, nunca en el sandbox que ejecuta el código. Solo vive en la pestaña, salvo que marques *Remember*, que la guarda en el almacenamiento de este navegador: cualquier página del mismo origen puede leerla, y en github.io eso incluye todos los proyectos de la misma cuenta. Ollama responde tal cual a páginas en `localhost`; para este sitio, arráncalo con `OLLAMA_ORIGINS=<origen del sitio> ollama serve` (el comando exacto aparece en Settings).

Los modelos locales pequeños (≈8B) escriben código 3D simple y a veces incorrecto; los modelos grandes lo hacen mucho mejor. Coincide con los benchmarks publicados que recoge [`research/fuentes.md`](research/fuentes.md).

## CLI

```sh
pnpm meshcode build examples/torch.js -o torch.glb   # código → GLB
pnpm meshcode build examples/torch.js --meshopt      # + dedup y EXT_meshopt_compression
pnpm meshcode inspect torch.glb                      # mallas, instancias, triángulos, bbox
pnpm meshcode decompile torch.glb -o torch.js        # GLB → código (+ archivos de textura) y verifica la fidelidad
pnpm meshcode verify a.glb b.js --min 0.99           # IoU de siluetas + diferencias de materiales entre dos modelos
pnpm meshcode build examples/2d/adventurer-walk.js -o walk.png   # 2D: la extensión de salida decide PNG / JPG / WebP
pnpm meshcode build examples/2d/item-icons.svg                    # entra SVG o HTML → sale PNG

# IA opcional (por defecto: Ollama local en http://localhost:11434/v1, primer modelo de la lista)
pnpm meshcode generate "una silla de madera con asiento tejido" -o silla.js
pnpm meshcode generate "un ícono de poción de vida de 32×32" --2d --critique --model llava
pnpm meshcode generate "un cofre del tesoro" --provider anthropic   # ANTHROPIC_API_KEY
pnpm meshcode decompile modelo.glb --llm -o modelo.js               # reescritura legible, solo si coincide
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
MESHCODE_OLLAMA_MODEL=dolphin3 pnpm test   # además prueba un modelo local real (lento, opcional)
```

Los tests de IA usan un servidor simulado con respuestas guionizadas (compatible con OpenAI y con Anthropic), así que son deterministas y no necesitan clave.

No se usa npm. pnpm está configurado en [`pnpm-workspace.yaml`](pnpm-workspace.yaml) para bloquear los scripts de instalación de las dependencias y para ignorar versiones publicadas hace menos de 3 días. Las actions de CI están fijadas por SHA de commit.

## Licencia

- Código: [MIT](LICENSE).
- Texto de investigación y datos del benchmark (`research/`, resultados): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Los assets CC0 de terceros conservan su propia licencia (indicada junto a ellos).

## Cita

Ver [`CITATION.cff`](CITATION.cff) o el botón "Cite this repository" de GitHub.
