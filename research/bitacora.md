# Bitácora de investigación — benchmark archivos vs híbrido vs código

Cuaderno de laboratorio del estudio. Cada entrada registra qué se hizo, las decisiones y su motivo, los resultados con su procedencia (comando que los regenera), las observaciones y las amenazas a la validez detectadas. Las cifras citadas salen de `bench/results/`, que se regenera con los comandos indicados.

Equipo: Intel i3-13100F, AMD Radeon RX 6400/6500 XT, 15 GB RAM, Linux, Google Chrome 158, Node 22, three.js 0.187.0.

---

## 2026-11-23 · Fase 4.1 — Juego de prueba y tres variantes (estudio controlado)

### Objetivo

Construir un juego idéntico en tres variantes que solo difieran en **de dónde salen los assets**: descargados como archivos o generados por código. Además, comprobar que se ven iguales **antes** de medir nada (regla 1 del protocolo, `fuentes.md` §1.4).

### El juego

Shooter de arena original (`bench/game/`), sin intervención humana:

- **Escenario:** arena de 40 × 40 m con suelo de placas de acero, muros de hormigón con franja de peligro y 12 pilares con anillos de luz.
- **Objetos:** 83 cajas y 60 barriles colocados con una semilla.
- **Enemigos:** 40 drones con patrullas de Lissajous (13 piezas cada uno, con rotores que giran).
- **Disparos:** una cámara-bot recorre una elipse y dispara 12,5 proyectiles/s. Cada impacto produce una explosión (billboard) y 32 chispas.
- **Ambiente:** 3000 partículas de polvo.
- **Render:** sombra direccional de 2048², tone mapping ACES y 80 draw calls por frame (incluido el pase de sombras), con unos 816 000 triángulos.

### Definición operativa de las variantes

| componente | **code** (C) | **hybrid** (B) | **files** (A) |
|---|---|---|---|
| Modelos (geometría + materiales) | se construyen en runtime (JS) | GLB con meshopt | GLB con meshopt |
| Texturas de color | se dibujan en canvas en runtime | dentro del GLB (PNG o WebP) | dentro del GLB (PNG o WebP) |
| Efectos (explosión, chispas, polvo) | shaders procedurales | shaders procedurales | flipbook 8×8 (1024²) + sprite (64²) |
| Layout del nivel | generado con semilla | generado con semilla | `layout.json` descargado |
| Lógica, cámara, simulación, instancing | código idéntico en las tres | idéntico | idéntico |

Sub-condición de formato de textura en A y B: **PNG** (sin pérdida) y **WebP q = 0,9** (con pérdida). Quedan 5 configuraciones: `code`, `hybrid·png`, `hybrid·webp`, `files·png` y `files·webp`.

### Decisiones metodológicas

1. **Una sola fuente de verdad.** Los modelos, texturas y efectos de la variante C son el código fuente. Los archivos de A y B se **hornean** a partir de él con meshcode:
   - modelos → GLB (`buildFile` + `meshoptGLB`);
   - texturas → WebP (re-codificadas en Chrome, extensión `EXT_texture_webp`);
   - flipbook y sprite → renderizados con los mismos shaders;
   - layout → el mismo generador.

   Así la equivalencia visual se da por construcción y la diferencia entre variantes es solo el formato de entrega. Comando: `pnpm bench:build`.
2. **Mundo analítico.** Todo lo que se ve es una función pura de *t*: posiciones de drones, disparos (el disparo *k* sale en *k*·0,08 s hacia el dron (13*k* mod 40)), llegada de cada proyectil y vida de cada explosión. Las chispas solo se escriben al nacer; las mueve el vertex shader. Consecuencias:
   - la ejecución es determinista;
   - no depende de los fps, así que cada variante hace el mismo trabajo por frame aunque vaya a distinta velocidad;
   - cualquier instante se puede renderizar exacto (`?freeze=t`).
3. **Mismas buenas prácticas en todas.** Hay un único `instancer()` (una `InstancedMesh` por pieza de cada plantilla), aplicado igual a las plantillas cargadas de GLB y a las construidas por código. Verificado: 80 draw calls, el mismo número de triángulos y 11 programas en las 5 configuraciones.
4. **Efectos: matemática frente a muestreo de textura.** Los efectos usan el mismo vertex shader y la misma geometría instanciada. Solo cambia el fragment shader: en C y B calcula la explosión (fbm de 5 octavas); en A lee el flipbook. El frame *i* del flipbook guarda la explosión en la mitad de su intervalo de edad, (*i* + 0,5)/64.
5. **Exclusiones para no mezclar efectos:**
   - **Sin normal maps:** GLTFLoader invierte `normalScale.y` cuando faltan tangentes.
   - **Anisotropía 1:** glTF no la guarda.
   - **Sin texto en las texturas:** las fuentes cambian entre dispositivos.
6. **KTX2/Basis aplazado.** El equipo no tiene `toktx` ni `basisu`. Es el único formato que reduce la VRAM, así que es una sub-condición importante pendiente (ver «Pendientes»). *Resuelto en la fase 4.1b.*
7. **Umbrales del gate fijados antes de la primera ejecución:**
   - solo escena: PSNR ≥ 35 dB y ≥ 99 % de píxeles a ±8 niveles en cada canal;
   - con efectos: PSNR ≥ 30 dB y ≥ 97 %.

   Hay además un **control negativo**: la propia variante C un frame (1/60 s) más tarde debe **no** pasar el gate.

### Resultado 1 — Gate de equivalencia visual (`pnpm bench:check` → `bench/results/equivalence.md`)

Se compararon 4 instantes (3,0 / 6,3 / 11,7 / 19,2 s) a 960×540, sin y con efectos, contra C.

| configuración | PSNR mínimo (escena / con efectos) | píxeles a ±8, mínimo |
|---|---:|---:|
| hybrid·png | 53,2 / 53,3 dB | 99,94 % |
| hybrid·webp | 49,6 / 49,8 dB | 99,90 % |
| files·png | 53,2 / 52,9 dB | 99,92 % |
| files·webp | 49,6 / 48,9 dB | 99,87 % |
| **control: C a +1 frame** | **27,2 / 25,1 dB** | **86,19 %** → falla, como debe |

Las 32 comparaciones pasan con mucho margen y el control negativo falla. Las variantes se diferencian de C entre ~170 y ~660 veces menos (en MSE) que dos frames consecutivos de C. Las diferencias residuales vienen de tres sitios (figura `bench/results/figure-equivalence.png`: C | files·webp | diferencia ×10):

- la cuantización de vértices de meshopt, en los bordes;
- la compresión WebP;
- la cuantización temporal del flipbook, en las explosiones.

**Conclusión:** las variantes son comparables.

### Resultado 2 — Comparativa estática (`pnpm bench:static` → `bench/results/static.md`)

Transferencia (KB; servidor local sin compresión; gzip-6 y brotli-11 calculados sobre los mismos archivos):

| configuración | peticiones | total crudo | total gzip | **total brotli** | de ello: modelos GLB (crudo) | efectos (crudo) |
|---|---:|---:|---:|---:|---:|---:|
| code | 3 | 744,8 | 189,7 | **153,6** | — | — |
| hybrid·webp | 9 | 1437,1 | 769,0 | **725,4** | 627,2 | — |
| hybrid·png | 9 | 3698,3 | 3009,9 | **2935,8** | 2888,3 | — |
| files·webp | 12 | 1637,6 | 953,6 | **909,5** | 627,2 | 177,2 |
| files·png | 12 | 4333,9 | 3623,1 | **3545,4** | 2888,3 | 612,4 |

Desglose del JS (chunks de Vite, en brotli):

- **Compartido por todas** (three.js + juego): 154,7 KB.
- **Los 5 modelos como código:** 2,5 KB (7,3 KB minificado).
- **Cargador de archivos** (GLTFLoader + decoder meshopt en WASM): 18,6 KB (73,5 KB minificado).

GPU en el primer frame (estimación: buffers únicos y texturas a 4 B/texel, +⅓ con mipmaps):

| configuración | geometría MB | texturas MB | texturas |
|---|---:|---:|---:|
| code | 0,41 | 9,50 | 5 |
| hybrid (png/webp) | 0,32 | 9,50 | 5 |
| files (png/webp) | 0,32 | 13,52 | 7 |

Generación en la variante C (mediana de 5 cargas en frío, ms): arena 45,2 · caja 8,7 · barril 2,0 · dron 1,3 · proyectil 0,4 · layout 1,0. **Total ≈ 59 ms.**

Carga preliminar, **no válida como dato de tiempos**: el renderer headless resultó ser **SwiftShader** (CPU), el servidor es local y solo hay 5 repeticiones. El primer frame llega a los 237–250 ms en las 5 configuraciones, con rangos que se solapan, así que no separan las variantes.

### Observaciones

1. **Bytes: el código gana por mucho en este contenido.** Las cifras siguientes son totales con brotli:
   - C transfiere 154 KB.
   - Respecto al mejor caso de archivos (files·webp, 910 KB) es **5,9× menos**, y frente a files·png es **23× menos**.
   - Solo en modelos: 2,5 KB de código frente a 556 KB de GLB WebP, unas **225×**.
2. **El código de los modelos ocupa menos que el cargador que necesitan los archivos** (2,5 KB frente a 18,6 KB, ambos con brotli). Es un coste fijo de la vía de archivos que no suele mencionarse.
3. **WebP reduce la descarga, no la VRAM.** Los GLB pasan de 2,9 MB a 627 KB (4,6× menos), pero en GPU las texturas siguen ocupando 9,5 MB, igual que con PNG: ambos se decodifican a RGBA. Solo los formatos comprimidos en GPU (KTX2/Basis) bajan la VRAM. Coincide con [15] (Khronos).
4. **meshopt también ahorra VRAM.** Las variantes con GLB usan un 22 % menos de memoria de geometría (0,32 frente a 0,41 MB) por la cuantización (posiciones y normales en enteros normalizados) y la deduplicación. Es un beneficio del pipeline de archivos que el código no tiene por defecto (podría cuantizar en runtime, pero no es lo habitual).
5. **Efecto horneado frente a efecto procedural.** Es un intercambio de **memoria por cálculo**: el flipbook añade 4 MB de VRAM (1024² RGBA) y 175–608 KB de descarga, mientras que el shader procedural no ocupa memoria pero hace un fbm de 5 octavas por fragmento. La fase 5 debe medir tiempo de GPU para saber qué pesa más.
6. **La generación cuesta ~59 ms de CPU en este i3, y el 77 % se va en las texturas de la arena** (bucles por píxel de 1024²). Es el coste que sustituye a «descargar y decodificar». En móvil se espera de 3 a 5 veces más (a medir).
7. **Sin red, decodificar y generar empatan en este equipo.** Las diferencias de tiempo deberían aparecer con red limitada (perjudica a A y B) y con CPU lenta (perjudica a C). Es exactamente lo que la fase 5 tiene que cruzar.

### Amenazas a la validez detectadas

- **Contenido favorable al código.** Las texturas son ruido y patrones geométricos: son baratas de describir en código e incompresibles como píxeles (el argumento de .kkrieger [26]). Las texturas pintadas a mano o fotográficas no admiten una descripción compacta. Por eso hace falta el **estudio real (4.2)**: assets CC0 hechos por artistas frente a su mejor imitación en código.
- **Sesgo del diseñador.** El contenido lo diseñamos nosotros, aunque sin optimizar para ninguna variante. El estudio real también lo mitiga.
- **PNG como base infla los archivos.** Por eso se añadió WebP; KTX2 está pendiente.
- **Una sola máquina, servidor local y SwiftShader.** Los tiempos de esta fase no se usan para conclusiones.

### Pendientes

- **4.2 · Estudio con assets reales:** packs CC0 (Kenney, Quaternius) en GLB frente a su imitación en código (escrita a mano o con LLM, con el gate visual relajado a «perceptualmente comparable» y registrado como tal).
- ~~**KTX2/Basis:** instalar KTX-Software (`toktx`) o `basisu` para la sub-condición que reduce VRAM.~~ Hecho en la 4.1b, con el encoder WASM oficial y sin instalar nada en el sistema.
- **Fase 5 · arnés de medición:**
  - Chrome con GPU real (no SwiftShader);
  - frames sin vsync y tiempo de GPU (`EXT_disjoint_timer_query`);
  - red limitada;
  - ≥ 30 repeticiones aleatorizadas;
  - Android por `adb`.

---

## 2026-11-23 · Fase 4.1b — Sub-condición KTX2 / Basis Universal

### Objetivo

Añadir a las variantes con archivos (A y B) el único formato de textura que **sigue comprimido en la GPU**. Sin él, los archivos no compiten con su mejor práctica (regla 2 del protocolo) y la comparación de VRAM queda sesgada a favor del código. Cubre además el hueco #3 del dossier: procedural frente a PNG frente a KTX2, midiendo VRAM.

### Qué se hizo

- **Encoder:** el oficial de Basis Universal (BinomialLLC, Apache-2.0), versión **v2_50**, en su build WASM precompilado (`basis_encoder.js` + `.wasm`).
  - Está en `bench/vendor/basis/`, con su LICENSE y los SHA-256 anotados en `bench/README.md`.
  - Se ejecuta en Node dentro de `pnpm bench:build`, sin instalar nada en el sistema.
- **Dos modos**, sobre las mismas texturas PNG horneadas del código:
  - **UASTC** (LDR 4×4 + Zstandard): calidad alta, archivo grande.
  - **ETC1S**: calidad media, archivo muy pequeño.

  Quedan 4 configuraciones nuevas: `hybrid·uastc`, `hybrid·etc1s`, `files·uastc` y `files·etc1s`. En total hay **9**.
- **Decodificación:** el `KTX2Loader` de three.js, con el transcoder que trae three.js. El loader se carga con import dinámico solo en las configuraciones KTX2, así que png y webp no pagan su descarga (verificado en las peticiones).
- **Estimación de VRAM:** para texturas KTX2 se suman los bytes reales de los bloques transcodificados, cadena de mipmaps incluida. Se registra el formato de GPU elegido.

### Decisiones metodológicas

1. **Ajustes por defecto del encoder, sin tocar para pasar el gate:**
   - UASTC con el nivel por defecto, sin RDO y con Zstandard;
   - ETC1S con calidad 128 y esfuerzo 2.

   Ajustar los parámetros hasta que pasen sería ajustar el resultado a la prueba.
2. **Espacio de color:**
   - Las texturas de color de los modelos (slots `baseColor`/`emissive`) van en **sRGB**, con métrica perceptual y mipmaps generados en sRGB.
   - El flipbook y el sprite contienen la salida del shader (datos lineales): sin métrica perceptual y sin mipmaps, igual que en la vía PNG.
3. **Los mipmaps los genera el encoder** (en la vía PNG/WebP y en el código los genera la GPU con `generateMipmap`). Es una fuente menor de diferencia visual a distancia, inherente al formato.
4. **El gate pasa a ser un filtro, con los mismos umbrales de la 4.1.**
   - Una configuración que no pasa es un resultado, no un error: se anota como **excluida** de las comparaciones de tiempos (fase 5) y su lista se guarda en `results/equivalence.json` (`admitted` / `excluded`).
   - La ejecución solo falla si el control negativo pasa, es decir, si el gate deja de distinguir frames.
5. **El formato de GPU lo elige `KTX2Loader.detectSupport`** según las extensiones del dispositivo. En este equipo, en headless con SwiftShader, elige **BC7** (1 B/texel) tanto para UASTC como para ETC1S.

### Resultado 1 — Gate (`pnpm bench:check` → `bench/results/equivalence.md`, figura `figure-etc1s.png`)

| configuración | PSNR mínimo (escena / con efectos) | píxeles a ±8, mínimo | veredicto |
|---|---:|---:|---|
| hybrid·uastc | 45,4 / 45,7 dB | 99,48 % | **admitida** |
| files·uastc | 45,4 / 45,5 dB | 99,48 % | **admitida** |
| hybrid·etc1s | 36,3 / 36,5 dB | 92,41 % | **excluida** (no llega al 99 %) |
| files·etc1s | 36,3 / 36,4 dB | 92,41 % | **excluida** |
| control: C a +1 frame | 27,2 / 25,1 dB | 86,19 % | falla, como debe |

ETC1S supera el umbral de PSNR (35 dB), pero solo el 92–95 % de los píxeles queda a ±8, frente al 99 % exigido. Su error medio (1,6–2,0 niveles) es la mitad del que hay entre dos frames consecutivos (3,6–4,2). En la figura (C | files·etc1s | diferencia ×10), el error se concentra en:

- el grano por píxel del suelo y los muros;
- los bordes de las cajas;
- la pintura de los drones.

Es sobre todo error de croma: ETC1S codifica cada bloque de 4×4 con colores de extremo compartidos y no puede seguir el ruido por píxel. A simple vista los frames casi no se distinguen, pero el criterio fijado de antemano los rechaza.

### Resultado 2 — Bytes y VRAM (`pnpm bench:static` → `bench/results/static.md`)

| configuración | descarga brotli (KB) | texturas en GPU (MB) | formato en GPU |
|---|---:|---:|---|
| code | **153,9** | 9,50 | RGBA8 |
| hybrid·webp | 726,4 | 9,50 | RGBA8 |
| hybrid·uastc | 2269,7 | **2,38** | BC7 |
| hybrid·etc1s *(excluida)* | 684,7 | 2,38 | BC7 |
| files·webp | 910,5 | 13,52 | RGBA8 |
| files·uastc | 2556,4 | **3,38** | BC7 |
| files·etc1s *(excluida)* | 764,4 | 3,38 | BC7 |

Tamaño por asset, en crudo:

| asset | PNG | WebP | UASTC | ETC1S |
|---|---:|---:|---:|---:|
| arena.glb | 2437,5 KB | 468,1 KB | 1600,0 KB | 228,8 KB |
| explosion (flipbook) | 608,1 KB | 175,5 KB | 277,5 KB | 71,4 KB |

**Costo fijo de la vía KTX2**, descargado solo en esas configuraciones: 232,5 KB en brotli (629 KB en crudo). Se reparte en:

- `KTX2Loader`: 20,3 KB;
- transcoder JS: 13,4 KB;
- transcoder WASM: 198,8 KB.

Carga preliminar (**SwiftShader, no válida como dato de tiempos**): «assets listos» pasa de 107–125 ms (png/webp) a 256–298 ms (KTX2), unos +150–190 ms. Es el tiempo de compilar el WASM y transcodificar en los workers.

### Observaciones

1. **KTX2 es el único caso en que los archivos ganan en VRAM: 4× menos** (9,50 → 2,38 MB; 1 B/texel en BC7 frente a 4 B en RGBA8).
   - El código no puede igualarlo de forma barata. Sus texturas de canvas se suben sin comprimir, y comprimirlas en runtime exigiría el encoder (3,3 MB de WASM) y segundos de CPU: el flipbook tarda unos 3 s en UASTC en este i3.
   - Es la ventaja estructural más clara de la vía de archivos encontrada hasta ahora.
2. **No hay ganador único: el resultado es un intercambio en tres ejes.**
   - **Bytes:** gana el código (154 KB).
   - **VRAM:** gana UASTC (2,4 MB), pero descarga 15× más que el código y 3,1× más que WebP.
   - **CPU de carga:** el código paga ~59 ms generando; KTX2 paga la transcodificación.
   - WebP queda en medio: pocos bytes, pero la misma VRAM que el código.
3. **Solo el transcoder pesa más que toda la variante código** (232,5 frente a 153,9 KB en brotli). Igual que el GLTFLoader en la 4.1, es un costo fijo de la vía de archivos que se amortiza con más contenido, pero que en un juego pequeño domina.
4. **UASTC descarga más que WebP.** La razón es que UASTC guarda bloques listos para la GPU (8 bits por texel) y solo los comprime después con Zstandard; WebP, en cambio, es un códec perceptual con pérdida. Con zstd aplicado, brotli ya no reduce nada más (1955 → 1867 KB en los GLB).
5. **ETC1S habría sido el mejor en bytes con archivos** (685 KB, menos que WebP), **pero no pasa la equivalencia visual.**
   - Las texturas de ruido de este juego son su peor caso.
   - Además, en este dispositivo se transcodifica a BC7, así que no ahorra VRAM frente a UASTC. Su ventaja de VRAM (0,5 B/texel con ETC1/BC1) solo aparecería en GPUs sin BC7 ni ASTC.
   - **Corrección de una predicción del plan:** había estimado ~1,2 MB de VRAM para ETC1S; en este equipo son 2,38 MB.

### Amenazas a la validez

- **Ajustes del encoder:** solo se probaron los valores por defecto. Con RDO en UASTC o con una calidad mayor en ETC1S, el reparto entre bytes y calidad cambiaría. Queda como análisis de sensibilidad opcional, declarado como exploratorio.
- **Formato de GPU dependiente del dispositivo:** en Android, `detectSupport` elegirá ASTC 4×4 o ETC2. La VRAM definitiva por dispositivo sale de la fase 5.
- **SwiftShader** sigue siendo el renderer en headless, así que ninguna cifra de tiempo de esta entrada sirve para conclusiones.
- **Contenido:** el ruido procedural es el peor caso de cualquier códec con pérdida (WebP, ETC1S, UASTC), lo que penaliza a los archivos en el gate. El estudio con assets reales (4.2) también mitiga esto.

### Configuraciones que pasan a la fase 5

`code`, `hybrid·png`, `hybrid·webp`, `hybrid·uastc`, `files·png`, `files·webp`, `files·uastc`. Total: **7**. ETC1S se reporta solo en bytes y VRAM, marcado como excluido.

---

## 2026-11-23 · Fase 4.2 — Estudio con assets reales (CC0) frente a su imitación en código

### Objetivo

En la 4.1 los assets salieron de nuestro propio código, con texturas de ruido, que es el terreno favorable al código. Aquí se invierte el planteamiento: se parte de **modelos hechos por artistas** y se mide qué cuesta llevarlos a código y qué se gana o pierde en runtime.

### Assets (descargados el 2026-11-23 de los repos oficiales en GitHub; licencias en `bench/real/source/`)

| papel en el juego | asset | autor / pack | tris | textura |
|---|---|---|---:|---|
| dron (enemigo) | `enemy-flying.glb` | Kenney, Starter-Kit-FPS (CC0) | 544 | atlas de paleta 512², PNG 9 KB |
| caja | `cargo_A` | Kay Lousberg, KayKit Space Base Bits 1.0 (CC0) | 128 | atlas de paleta 1024², PNG 25 KB |
| barril | `Barrel_A` | Kay Lousberg, KayKit Prototype Bits 1.0 (CC0) | 384 | atlas de paleta 1024², PNG 29 KB |

La web de Kenney (kenney.nl) responde 403 a clientes automáticos, así que se usó su GitHub oficial (KenneyNL). Los tres modelos son low-poly con **atlas de paleta**: cada cara toma su color de un degradado de la textura mediante UV. Es el estilo dominante en los packs CC0 y es distinto del caso controlado.

### Variantes (solo cambia cómo se entregan los tres props)

El resto del juego es idéntico en todas y va como código: arena, proyectil, efectos por shader y layout por semilla.

| variante | props | cómo se obtiene |
|---|---|---|
| **real-glb** (archivos) | GLB original empaquetado + meshopt; atlas en PNG, tal como lo distribuye el artista (sub-condición UASTC) | `bench/real` → build |
| **real-decompiled** (código de máquina) | módulo JS generado por `meshcode decompile`: geometría como datos base64 + atlas PNG aparte | determinista, sin intervención |
| **real-code** (código de autor) | imitación paramétrica escrita a mano por el agente (Claude Opus 5.5 en Claude Code), sin texturas | medición del original (`bench/real/measure.mjs`) + ciclo render → comparar (`bench/real/compare.mjs`) |

**Ajuste de tamaño, igual en todas las variantes:** escala uniforme para que la dimensión mayor coincida con la del prop controlado (caja 1,0 m, barril 0,9 m, dron 1,31 m). Los props se apoyan en el suelo y el dron se centra en su origen.

### Umbrales registrados ANTES de escribir las imitaciones

- **real-decompiled frente a real-glb** (conversión exacta): IoU de siluetas ≥ 0,999 en las 6 vistas, y el gate de escena estricto de la 4.1 (PSNR ≥ 35 / 30 dB y ≥ 99 / 97 % a ±8).
- **real-code frente a real-glb** («perceptualmente comparable», un criterio más laxo declarado como tal), por modelo:
  - IoU medio de siluetas ≥ 0,90 y cada vista ≥ 0,85 (6 vistas a 256 px, métrica de `fidelity.js`);
  - error de color medio ≤ 12 niveles (de 255) sobre la intersección de siluetas, en las 4 vistas de `renderViews` (384 px);
  - además, una hoja comparativa de cada modelo para el juicio humano (tuyo).

  El gate de escena de real-code se **reporta sin criterio de aprobado**, porque una imitación no puede coincidir píxel a píxel.
- **Costo de autoría que se registra:**
  - líneas y bytes de cada imitación;
  - número de iteraciones del ciclo render → comparar;
  - IoU y error de color tras cada iteración.

### Registro de autoría (real-code)

Medición antes de escribir: `measure.mjs` dio, para cada color de la paleta, sus caras, su extensión y sus normales, y además los perfiles de los anillos y las secciones. Así salieron las primitivas reales:

- el barril es un torno de 12 lados con 17 puntos de perfil;
- la caja y el torso del dron son **cajas redondeadas**: núcleo 0,1875 con chaflán 0,0625 en la caja; núcleo 0,2 con radio 0,1 en 2 pasos en el torso;
- los cañones son un perfil de 8 vértices extruido.

Kit compartido (`bench/real/models/kit.js`): apila anillos en una malla facetada con color por cara. Ofrece:

- `loft` (anillos), `box` (caja redondeada) y `plate` (polígono plano);
- un degradado de paleta;
- normales suaves por ángulo de pliegue;
- espejo.

| modelo | iteración | cambio | IoU medio / mín | error de color |
|---|---|---|---|---:|
| barril | v1 | torno + degradado lineal, facetado | 1,000 / 1,000 | 5,8 |
| barril | **v2** | normales suaves alrededor del eje (el corte entre anillos sigue duro) + paradas del degradado medidas | 1,000 / 1,000 | **3,0** |
| caja | v1 | caja redondeada + corte de color a 0,25 m + etiquetas + tornillo | 1,000 / 1,000 | 7,5 |
| caja | **v2** | suavizado por pliegue de 50° (el original tiene los chaflanes suaves) | 1,000 / 1,000 | **4,3** |
| dron | v1 | torso, placa frontal, cara, antena; cañones como bloques | 0,914 / 0,870 | 13,0 ❌ |
| dron | v2 | cañones rehechos con el perfil medido (soporte octogonal, cuerpo extruido, aleta, mira, boca) | 0,967 / 0,943 | 9,4 |
| dron | **v3** | placa frontal en dos bandas de color | 0,967 / 0,943 | **9,4** (sin mejora; se detiene aquí) |

**Esfuerzo:** 7 iteraciones del ciclo render → comparar y **191 líneas de código** sin contar comentarios: barril 12, caja 19, dron 61 y el kit compartido 99. Más de la mitad está en el kit, que es reutilizable: un cuarto prop del mismo estilo costaría unas 10–60 líneas.

### Resultado 1 — Gate por modelo (`pnpm bench:real` → `bench/results/real-models.md`, hojas `figure-real-{crate,barrel,drone}.png`)

| prop | entrega | IoU medio | IoU mín | error de color | tris (orig → copia) | veredicto |
|---|---|---:|---:|---:|---:|---|
| caja | decompiled | 1,000 | 1,000 | 0,0 | 128 → 128 | ✅ |
| caja | imitación | 1,000 | 1,000 | 4,3 | 128 → 128 | ✅ |
| barril | decompiled | 1,000 | 1,000 | 0,0 | 384 → 384 | ✅ |
| barril | imitación | 1,000 | 1,000 | 3,0 | 384 → 384 | ✅ |
| dron | decompiled | 1,000 | 1,000 | 0,1 | 544 → 544 | ✅ |
| dron | imitación | 0,967 | 0,943 | 9,4 | 544 → 570 | ✅ |

Las tres imitaciones pasan el criterio registrado (IoU ≥ 0,90, vistas ≥ 0,85, color ≤ 12). La caja y el barril tienen **la misma silueta exacta y el mismo número de triángulos**: el original ya era paramétrico. El dron, con cara y cañones de detalle, es donde la imitación se separa más.

### Resultado 2 — Gate de escena (`pnpm bench:check --set real` → `bench/results/equivalence-real.md`, figura `figure-real.png`)

Referencia: real-glb·png (el original tal cual).

| configuración | PSNR mín. (escena / con efectos) | píxeles a ±8, mín. | veredicto |
|---|---:|---:|---|
| real-glb·png128 (atlas reducido a ≤ 128 px) | 57,0 / 57,1 dB | **100,00 %** | admitida |
| real-glb·uastc | 49,6 / 50,1 dB | 99,50 % | admitida |
| real-decompiled | 52,2 / 52,5 dB | 99,80 % | admitida |
| real-code (imitación; solo se reporta) | 30,5 / 30,6 dB | 92,49 % | se reporta (el gate es por modelo) |
| control: original a +1 frame | 28,1 / 25,7 dB | 87,40 % | falla, como debe |

**Lectura:** en la escena, la imitación difiere del original con un error medio de 1,4–1,8 niveles. Es la mitad que dos frames consecutivos (3,3–3,8) y está en el rango de ETC1S en la 4.1b. A simple vista los props son los mismos; las diferencias están en el sombreado de las normales y en los degradados.

**Decisión añadida durante la fase (regla 2, mismas buenas prácticas):** los atlas de paleta de los artistas son de 512² y 1024², tamaños excesivos para una paleta de unos 20 colores. La optimización estándar de la vía archivos es **reducir el atlas**. Se añadió `png128`: atlas reducido con filtro de caja a ≤ 128 px. Pasa con 57 dB y el 100 % de los píxeles a ±8, así que se toma como **línea base justa de archivos** en el estudio real. Sin ella, los 12 MiB de VRAM de los atlas serían un artefacto de cómo exportó el artista, no del formato.

### Resultado 3 — Bytes, VRAM y generación (`pnpm bench:static --set real` → `bench/results/static-real.md`)

Solo los props (columna "models" del informe; brotli-11):

| entrega de los props | descarga props | descarga total del juego | VRAM texturas props | VRAM geometría (juego) | generación en CPU |
|---|---:|---:|---:|---:|---:|
| **real-code** (imitación) | **2,6 KB** | **179,1 KB** | **0** | 0,32 MB | 8,4 ms (caja 2,5 · barril 2,1 · dron 3,8) |
| real-glb·png128 (mejor práctica de archivos) | 27,3 KB | 203,8 KB | 0,25 MiB | 0,25 MB | — |
| real-glb·png (tal como lo exporta el artista) | 69,7 KB | 246,2 KB | 12,00 MiB | 0,25 MB | — |
| real-decompiled | 70,3 KB (165,7 en crudo) | 246,8 KB | 12,00 MiB | 0,27 MB | — |
| real-glb·uastc | 267,1 KB (+232,5 KB de transcoder) | 676,1 KB | 3,00 MiB (BC7) | 0,25 MB | — |

La parte común (arena, proyectil, efectos y layout por código) pesa lo mismo en todas: 176,5 KB de JS y 8 MiB de texturas de la arena. Draw calls iguales (50). Triángulos: +1,8 % en la imitación, porque el dron tiene 570 en vez de 544.

Carga preliminar (**SwiftShader, no válida como dato**), mediana de «assets listos»:

- code 113 ms · decompiled 115 · png128 119 · png 130;
- uastc 268 (transcodificación).

### Resultado 4 — Imitación de un solo intento con un LLM local pequeño (`bench/real/llm-dolphin3/`)

Contraste con la imitación medida e iterada:

- **Montaje:** `meshcode generate` con Ollama `dolphin3` (8B, en CPU). Recibe solo una descripción en texto con medidas y colores (`prompts.json`) y tiene hasta 3 reparaciones automáticas.
- **Resultado: 0 de 3 utilizables.**

| prop | tiempo | resultado |
|---|---:|---|
| caja | 246 s | falla: usa `THREE.BoxBufferGeometry` (eliminado de three.js); en la última reparación no devuelve código |
| barril | 318 s | ejecuta, pero añade *geometrías* a un `Group` y deja las únicas mallas ocultas: IoU 0,126, sin píxeles en común |
| dron | 534 s | falla tras 3 reparaciones (`Cannot set properties of undefined`) |

Coincide con la literatura del dossier: APIs obsoletas o inventadas y escenas que no se corresponden con el código [7][8][18]. **No sirve para juzgar a los modelos de frontera**, que no se probaron:

- no hay API key en el equipo;
- el modelo en la nube de Ollama envía datos fuera, y no se usó sin permiso.

### Observaciones

1. **Con arte low-poly real, el código sigue ganando en bytes, pero la brecha se reduce mucho.**
   - Props: 2,6 KB de código frente a 27,3 KB de archivos optimizados, **10,5×**.
   - En el estudio controlado la diferencia era 225× (556 KB de GLB WebP). Ahí la brecha venía de las texturas de ruido; aquí, con texturas de paleta pequeñas, la geometría pesa poco en ambos formatos.
   - En el juego completo, la imitación descarga un 12 % menos que la mejor vía de archivos (179 frente a 204 KB).
2. **El arte low-poly de los packs CC0 ya es paramétrico.**
   - La caja y el barril se reproducen con **la misma silueta exacta y el mismo número de triángulos**, porque el artista modeló un torno de 12 lados y una caja con chaflán.
   - El color de paleta por UV se traduce directamente a colores de vértice.
   - Por eso la amenaza «contenido favorable al código» de la 4.1 no desaparece con estos assets. Lo que falta probar es arte orgánico, esculpido o con *skinning*.
3. **Los atlas de paleta tal como se exportan derrochan VRAM: 70 KB en disco ocupan 12 MiB en GPU.**
   - Unos 20 colores van guardados en texturas de 1024² RGBA con mipmaps.
   - La solución por el lado de los archivos es trivial (reducir el atlas a 128 px, 0,25 MiB) y no cambia la imagen: 100 % de píxeles a ±8.
   - El código con colores de vértice no usa texturas. A igualdad de buenas prácticas, la diferencia de VRAM es mínima (0 frente a 0,25 MiB).
   - Lección metodológica para el artículo: **comparar contra el archivo «tal cual» infla la ventaja del código.**
4. **KTX2 no conviene con atlas de paleta.** UASTC descarga 3,8× más que PNG (las paletas planas se comprimen muy bien en PNG y mal en bloques) y suma 232 KB de transcoder. Además ahorra menos VRAM (3 MiB) que simplemente reducir el atlas (0,25 MiB). Es lo contrario de lo que pasaba con las texturas de ruido de la 4.1b.
5. **El código generado por máquina no es compacto: es datos disfrazados.**
   - `meshcode decompile` reproduce los modelos exactamente (IoU 1,000), pero pesa lo mismo que el GLB en brotli (70,3 frente a 69,7 KB) y 1,6× más en crudo.
   - La compacidad del código no viene del formato JS, sino de la **descripción paramétrica** (un torno, una caja redondeada), que requiere entender la forma.
6. **El costo real de la vía código está en la autoría, no en el runtime.**
   - Runtime: 8,4 ms de CPU y 0,07 MB más de geometría (colores de vértice y vértices sin indexar). Es poco.
   - Autoría: medir el original, 191 líneas y 7 iteraciones guiadas por métricas.
   - Un LLM local pequeño, sin medidas ni iteración visual, no consigue ninguna imitación (0 de 3).
   - Es justo el punto que separa un juego «hecho solo con código» por un modelo de frontera con herramientas de uno hecho por un modelo pequeño.

### Amenazas a la validez

- **Muestra pequeña y simple:** 3 props low-poly. No incluye personajes, mallas orgánicas, *skinning* ni animaciones.
- **Quién imita:** las imitaciones las escribió un agente LLM de frontera (Claude Opus 5.5) **con acceso al original** (mide vértices y colores) y con un ciclo de comparación automático. Es el escenario «convertir un asset existente a código», no «crear desde cero». El costo de autoría para un humano sin estas herramientas sería mayor.
- **Gate más laxo** para la imitación, declarado como «perceptualmente comparable». En la escena (92–94 % a ±8) no pasaría el gate estricto, igual que ETC1S.
- **LLM local:** una sola ejecución por prop, un solo modelo pequeño y solo texto. No es representativo de los modelos de frontera.
- **SwiftShader:** sin datos de tiempo válidos (fase 5).

### Configuraciones del estudio real que pasan a la fase 5

`real-code`, `real-glb·png128` (línea base justa), `real-glb·png` (tal cual), `real-glb·uastc` y `real-decompiled`.

### Pendientes

- **Fase 5 · arnés de medición** (GPU real, sin vsync, red limitada, ≥ 30 repeticiones, Android) sobre las 7 configuraciones controladas y las 5 reales.
- **Opcional:** imitación de un solo intento con un modelo de frontera, para comparar con dolphin3. Requiere tu API key o tu permiso para usar el modelo en la nube de Ollama.
- **Opcional:** un asset orgánico o animado (un personaje CC0 de Quaternius o KayKit) para poner a prueba la observación 2.
