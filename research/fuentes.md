# Dossier de investigación: assets de juegos como código frente a archivos (GLB/PNG)

- Fecha de revisión: 2026-11-19
- Licencia del texto: CC BY 4.0
- Uso: base de fuentes para el artículo, que escribe el autor. Este documento **no** es el artículo.
- Referencias en BibTeX: [`referencias.bib`](referencias.bib). La clave BibTeX de cada fuente va entre corchetes, por ejemplo `[dev2026procedural]`.

---

## 1. Pregunta y condiciones

**Pregunta:** ¿qué formato de assets rinde mejor en tiempo de ejecución en un juego 3D web?

| Condición | Definición | Ejemplo |
|---|---|---|
| **A · files** | Toda la geometría, texturas y VFX vienen de archivos: GLB (con meshopt), PNG/KTX2 y sprite sheets. | Pipeline clásico de artistas o mallas generadas por IA (Meshy, Tripo). |
| **B · hybrid** | Las mallas y texturas son archivos (horneados a partir de código o hechos por artistas); los VFX, shaders y la variación procedural son código en runtime. | Pipeline que proponen a16z y 3DCodeVerse: el código como fuente y el archivo como artefacto. |
| **C · code** | Todo se construye en runtime con código: geometría, texturas procedurales y partículas. | Juegos hechos por agentes de IA "sin assets", como el shooter de Fable 5.2 citado como motivación (§8). |

**Hipótesis de trabajo** (a validar, no son conclusiones):
- C gana en bytes transferidos y en facilidad de edición.
- C pierde en tiempo de construcción en CPU, sobre todo en móvil.
- B debería quedarse con lo mejor de ambos.
- Con instancing aplicado por igual, el frame time en estado estable no debería depender del formato.

---

## 2. Hallazgos principales

1. **Los bytes no predicen el arranque.** En Three.js, el módulo procedural del árbol pesó 10,6 KB, frente a 41,9 KB del GLB raw y 24,1 KB del GLB con meshopt. Aun así fue el más lento en navegación fría: 376,5 ms contra 321,6 ms de meshopt. La diferencia está en la fase *asset-ready*: 62,3 ms el módulo, 20,3 ms meshopt. Los draw calls fueron iguales en todos los formatos. `[dev2026procedural]`
2. **Construir cuesta CPU y clonar es casi gratis.** En el mismo estudio, 20 llamadas al factory del coche tardaron 54,9 ms (WebGL2), mientras que 20 clones tardaron 0,6 ms. El autor concluye que hay que construir una vez y reutilizar. `[dev2026procedural]`
3. **Generar al cargar traslada el costo a la RAM y al tiempo de carga.** .kkrieger (2004) ocupa unos 96 KB en disco porque guarda recetas de generación en lugar de assets, y al ejecutarse ocupa unos 300 MB de RAM, con cargas largas. `[kkrieger]`
4. **Las texturas en formato de GPU siguen comprimidas en VRAM.** KTX2/Basis se mantiene comprimido en la GPU, mientras que PNG/JPG se descomprimen a tamaño completo. Una textura procedural (CanvasTexture o similar) tampoco se comprime. `[khronos2021ktx2]`
5. **En SDF y raymarching, el costo crece con píxeles × pasos, no con triángulos.** Las escenas SDF grandes son exigentes incluso en GPUs de escritorio, y los motores de juego prefieren convertirlas a polígonos. `[yariv2023bakedsdf]` `[frolov2024crossrt]` `[hackaday2023sdf]`
6. **En Canvas 2D, conviene hornear.** MDN recomienda pre-renderizar en un canvas offscreen lo que se repite. Un benchmark de 100k puntos dio 287 ms dibujando uno por uno, 15 ms en lote y 67 ms con un sprite offscreen. `[mdn-canvas]` `[aggrid-canvas]`
7. **Instancing y merge pesan más que el formato.** El instancing reduce los draw calls de O(n) a O(1). En Roblox, las Parts con propiedades iguales se agrupan en un solo draw call, mientras que las transparentes van una por una. `[threejs-forum-instancing]` `[roblox-instancing]`
8. **La calidad de lo que genera la IA como código es limitada:**
   - Mundos voxel de Three.js: el mejor modelo sacó 210,8/280, y en el 32% de los ítems el código y la imagen no coinciden. `[bakshi2026worldbench]`
   - Objetos estáticos: 23/37 aprobados.
   - Escenas: 0/5.
   - Shaders: 5/6, a $0,12 por resultado aprobado. `[gao2026codeverse]`
   - GLSL: los mejores modelos fallan en el 31% de los casos. `[kels2025shadermatch]`
   - SVG: la calidad se degrada cuando sube la complejidad. `[chen2025svgenius]` `[chen2025sgp]`
9. **Las mallas generadas por IA tienen más realismo y peor topología.** Meshy y Tripo dan la topología más limpia; Hunyuan3D y TRELLIS, mejor geometría bruta. "Generado" no equivale a "listo para el juego". `[scenario-3d]`
10. **Industria:**
    - El 36% de los profesionales usa GenAI y el 52% cree que daña la industria (30% en 2025). El rechazo es mayor cuando se usa para assets. `[gdc2026state]`
    - a16z sostiene que el código es la fuente de verdad visual y los píxeles solo el render; prevé flujos híbridos. `[li2026visualcode]`

---

## 3. Fuentes anotadas

Niveles de confiabilidad:
- **N1**: académica (revisada por pares o preprint).
- **N2**: informe de industria o estándar.
- **N3**: benchmark de practicante, blog o proveedor. Útil, pero de un solo autor y sin revisión.

### N1 — Académicas

**[shaker2016pcg] Procedural Content Generation in Games.** Shaker, Togelius y Nelson. Springer, 2016. ISBN 978-3-319-42714-0. https://pcgbook.com/
- Libro de texto clásico de la generación procedural (fractales, gramáticas, búsqueda, restricciones, mazmorras).
- *Uso:* marco teórico. La condición C es generación procedural constructiva en tiempo de ejecución.

**[summerville2018pcgml] Procedural Content Generation via Machine Learning (PCGML).** Summerville, Snodgrass, Guzdial, Holmgård, Hoover, Isaksen, Nealen y Togelius. *IEEE Transactions on Games* 10(3):257–270, 2018. arXiv:1702.00539.
- Define la generación de contenido con modelos entrenados sobre contenido existente.
- *Uso:* antecedente teórico. Los LLM que escriben código de assets son una forma de PCGML.

**[wang2024llamamesh] LLaMA-Mesh: Unifying 3D Mesh Generation with Language Models.** Wang, Lorraine, Wang, Su, Zhu, Fidler y Zeng (NVIDIA + Tsinghua). arXiv:2411.09595, noviembre de 2024.
- Representa las mallas como texto estilo OBJ (vértices y caras) y ajusta LLaMA-3.1-8B. Su calidad es comparable a la de modelos 3D especializados.
- *Limitación:* licencia no comercial (NSCLv1).
- *Uso:* la malla misma puede ser "código" o texto.

**[lu2025ll3m] LL3M: Large Language 3D Modelers.** Lu, Chen, Dinh, Lang, Holtzman y Hanocka. arXiv:2508.08228, agosto de 2025.
- Sistema multiagente que escribe Blender Python interpretable, con un RAG sobre la documentación de Blender (BlenderRAG).
- *Uso:* ejemplo de código como fuente de assets 3D.

**[dai2025meshcoder] MeshCoder: LLM-Powered Structured Mesh Code Generation from Point Clouds.** Dai, Luo, Tang, Wang, Lian, Xu, Qin, Xu, Dai, Wang, Lyu y Pang. NeurIPS 2025. arXiv:2508.14879.
- Un LLM multimodal convierte una nube de puntos en un script de Blender separado en partes semánticas, y el modelo se edita cambiando el código.
- *Uso:* antecedente directo de la dirección GLB → código de meshcode.

**[chen2025svgenius] SVGenius: Benchmarking LLMs in SVG Understanding, Editing and Generation.** Chen et al. (Zhejiang U.). arXiv:2506.03139, junio de 2025.
- 2.377 consultas y 22 modelos. Los modelos propietarios lideran, pero se degradan con la complejidad, y el razonamiento ayuda más que el tamaño.
- *Uso:* límites del 2D como código.

**[chen2025sgp] Symbolic Graphics Programming with Large Language Models (SGP-GenBench).** Chen, Zhang, Huang, Qiu, Zhang, Wen y Liu. arXiv:2509.05208, septiembre de 2025. Aceptado en TMLR.
- Benchmark de generación de SVG (fidelidad, composición, conteo). Con RL mejora mucho a un modelo de 7B.
- *Uso:* igual que SVGenius.

**[kels2025shadermatch] Evaluating Language Models for Computer Graphics Code Completion (ShaderMatch).** Kels, Dahou y Mathiak. LLM4Code @ ICSE 2025. DOI 10.1109/LLM4Code66737.2025.00017.
- 467 funciones GLSL tomadas de Shadertoy. Incluso los mejores modelos generan código que no funciona en el 31% de los casos, porque GLSL tiene pocos datos de entrenamiento.
- *Limitación:* el mantenedor advierte que hay contaminación de datos.
- *Uso:* fiabilidad de los VFX escritos como código.

**[bakshi2026worldbench] WorldBench: Evaluating LLMs on Three.js Voxel World Generation.** Bakshi. arXiv:2610.10622, 7 de octubre de 2026.
- Cada modelo escribe un HTML con una isla voxel de 10 biomas, física y ciclos de día y estación, evaluado sobre 280 puntos.
- Resultados: Claude Fable 5.1 210,79; GPT-6 Astra 199,73; Kimi K3 191,36; Grok 4.7 187,78; Gemini 3.1 Pro 149,00.
- El código y lo que se ve en pantalla discrepan en el 32% de 365 ítems. El 48% de los puntos perdidos corresponde a funciones no implementadas. Con un juez que solo lee el código, se acreditaría el 79% de los ítems; con uno que solo mira la imagen, el 53%.
- *Limitaciones:* una sola corrida por modelo, y los jueces son de la familia de Gemini.
- *Uso:* la calidad de los mundos generados como código, y que validar solo por código no basta (lo que justifica la puerta de equivalencia visual del protocolo).

**[gao2026codeverse] 3DCodeVerse: Exploring 3D Worlds as Code.** Gao, …, Itti (USC, Yale, Rochester, UCSD, Columbia, NTU, UCSC, Google DeepMind y Philo Labs). arXiv:2610.22341, 15 de octubre de 2026.
- Agentes que escriben assets 3D solo con código (Blender bpy, CadQuery, Three.js, URDF, GLSL, OpenGL), con un ciclo generar → medir → juzgar con visión → reparar.
- Dataset 3DCodeVerse-2M: unos 2,03 M de pares, con 269.597 programas únicos.
- Auditoría de costos (repo): objetos estáticos 23/37 a $2,37 por aprobado; articulados 8/13 a $2,17; escenas 0/5; shaders 5/6 a $0,12.
- Preferencia humana:
  - Paper: 90% de victorias frente a Claude Design en 60 prompts, ambos con Claude Opus 5.5.
  - Artículo de divulgación: de 21% a 79% en 100 prompts.
  - Son comparaciones distintas: hay que citar la del paper.
- *Limitaciones:* datasets CC BY-NC-SA, solo Linux.
- *Uso:* los shaders son el caso más barato y fiable del código, y las escenas completas siguen sin resolverse.
- Divulgación: https://artrealmai.com/article/3dcodeverse-coding-agents-build-3d-assets-as-code

**[yariv2023bakedsdf] BakedSDF: Meshing Neural SDFs for Real-Time View Synthesis.** Yariv, Hedman, Reiser, Verbin, Srinivasan, Szeliski, Barron y Mildenhall. arXiv:2302.14859, 2023.
- Convierte SDF a malla para lograr render en tiempo real.
- *Uso:* respaldo académico de la práctica de "hornear" el código a malla.

**[frolov2024crossrt] CrossRT.** Frolov, Sanzharov, Albert, Raenchuk y Voloboy. arXiv:2409.12617, 2024.
- En los motores de juego conviene trabajar con polígonos aunque los assets estén codificados como SDF.
- *Uso:* igual que BakedSDF.

### N2 — Industria y estándares

**[gdc2026state] GDC 2026 State of the Game Industry.** Informa/GDC, enero de 2026. Más de 2.300 encuestados.
- El 36% usa GenAI en su trabajo. El 52% cree que tiene un impacto negativo (30% en 2025 y 18% en 2024); solo el 7% lo ve positivo.
- *Cuidado:* GDC advierte que el cuestionario cambió, así que la comparación entre años es indicativa. El dato de "64% de artistas en contra" viene de prensa secundaria.
- Fuentes: https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/ y nota de prensa en BusinessWire (29 de enero de 2026).

**[li2026visualcode] The Next Frontier of Visual AI Is Code.** Yoko Li, a16z, 2 de junio de 2026. https://a16z.com/the-next-frontier-of-visual-ai-is-code/
- El código (SVG, HTML/CSS, Lottie, shaders, USD, Blender) es la fuente editable. La iteración render → inspección → corrección converge, mientras que la difusión solo vuelve a tirar los dados.
- Los píxeles siguen ganando en realismo y textura, y el autor prevé flujos híbridos.
- *Cuidado:* es una perspectiva de inversor, más direccional que demostrada.
- *Uso:* marco conceptual de la condición B.

**[khronos2021ktx2] Khronos KTX 2.0.** Comunicado de prensa de Khronos Group.
- Las texturas Basis Universal (modos ETC1S y UASTC) quedan comprimidas en la GPU; PNG/JPG se descomprimen a tamaño completo. Extensión glTF: `KHR_texture_basisu`.
- *Cuidado:* son cifras del propio estándar, no un benchmark independiente.
- https://www.khronos.org/news/press/khronos-ktx-2-0-textures-enable-compact-visually-rich-gltf-3d-assets

**[roblox2025cube] Cube: A Roblox View of 3D Intelligence.** Foundation AI Team, Roblox. arXiv:2503.15475, marzo de 2025.
- Modelo abierto de texto a malla que usa tokens de forma. Versión 0.5 y CubePart en 2026.
- *Uso:* una plataforma de juegos apuesta por mallas generadas, no por código. Es el contrapunto a la condición C.
- https://github.com/Roblox/cube

### N3 — Benchmarks de practicantes, blogs y proveedores

**[dev2026procedural] Procedural Three.js Assets vs GLB: 148 Local Navigations, Measured.** DEV Community, 2026. https://dev.to/alicia_lu/procedural-threejs-assets-vs-glb-148-local-navigations-measured-oe8
- **Es el antecedente más cercano.**
- Montaje: RTX 5070 Ti, HeadlessChrome 156, Three.js 0.186.1, WebGPU y WebGL2, 3 assets low-poly × 4 formas de entrega (módulo procedural, GLB raw, Draco, meshopt) × 5 repeticiones.
- Las cifras están en §2.1–2.2.
- **Limitaciones declaradas, que son los huecos de este estudio:**
  - sin móvil;
  - sin CDN ni red limitada;
  - sin escenas con muchas texturas;
  - con el tope de 16,7 ms por vsync, que impide distinguir frame times;
  - 5 repeticiones, sin significancia estadística;
  - sin medición directa de memoria.

**[threejsbench2026] 3JSBench.** Foro de three.js, 9 de octubre de 2026. https://discourse.threejs.org/t/3jsbench-a-benchmark-for-llm-generated-three-js-objects/95137
- Lo creó el autor de instaplay.ai (más de 40.000 juegos generados). Las mecánicas generadas funcionan, pero los objetos 3D no alcanzan el nivel: parpadeo, caras invisibles y objetos que se atraviesan.
- *Cuidado:* es un proveedor, y el método del ranking no está descrito.

**[ebert2025vibegame] VibeGame: Exploring Vibe Coding Games.** Dylan Ebert, Hugging Face, 29 de septiembre de 2025. https://huggingface.co/blog/vibegame
- Comparando Roblox, Unity y la web, los LLM rinden mejor en el stack web (three.js). El motor resultante usa primitivas con color.
- *Uso:* justifica elegir three.js para el benchmark.

**[mdn-canvas] MDN: Optimizing canvas.** https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- Recomienda pre-renderizar en un canvas offscreen lo que se repite.

**[aggrid-canvas] AG Grid: Optimising HTML5 Canvas Rendering.** https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/
- 100k puntos: 287,1 ms uno por uno, 15,4 ms en lote, 66,9 ms con sprite offscreen. Es la medición de un proveedor.

**[roblox-instancing] Roblox: Part Instancing pre-release.** Staff de Roblox en el DevForum. https://devforum.roblox.com/t/part-instancing-pre-release-announcement/130333/1
- Un número muy alto de draw calls se vuelve cuello de botella en la CPU. Las Parts con el mismo material y textura se agrupan, y las transparentes cuestan un draw call cada una.

**[threejs-forum-instancing] Foro de three.js: InstancedMesh y merge.** https://discourse.threejs.org/t/instancedmesh-for-simple-geometries/28658/2
- Si el cuello de botella son los draw calls, conviene hacer merge o usar InstancedMesh.

**[ccore-qwen-glb] Qwen3.5-4B-GLB-3D-Coder.** CCORE, Apache 2.0. https://www.stork.ai/blog/this-tiny-ai-builds-3d-game-assets
- Un modelo de 4B que escribe una escena Three.js con un botón para exportar a GLB. Prioriza la facilidad de edición sobre la fidelidad y funciona mejor en low-poly rígido.
- *Uso:* ya existe una herramienta de código → GLB; meshcode se diferencia por la dirección inversa, la métrica de fidelidad y el benchmark.

**[summer-blendermcp] Summer Engine: Blender MCP for games.** https://www.summerengine.com/blender-mcp-for-games
- Un script bpy exporta un GLB; los modificadores y Geometry Nodes se aplican al exportar y el color procedural se hornea a textura.
- *Uso:* así es la condición B en la práctica.

**[hackaday2023sdf] Hackaday: Signed Distance Functions: Modeling in Math (2023).** https://hackaday.com/2023/04/12/signed-distance-functions-modeling-in-math/

**[kkrieger] .kkrieger.** Historia oficial en el newsroom de Activision Blizzard: https://newsroom.activisionblizzard.com/p/a-brief-history-of-the-worlds-smallest
- Ganó la competencia 96k de Breakpoint 2004. Las cifras de unos 300 MB de RAM y la duración de la carga vienen de fuentes secundarias: hay que verificarlas antes de citarlas como dato duro.

**[levels2025fly] fly.pieter.com.** https://levels.io/full-multiplayer-python-websockets-game-ai
- Simulador de vuelo vibe-coded (Three.js + Cursor) que, según su autor, llegó a $1M de ingresos anuales recurrentes en 17 días.
- No hay confirmación de que no use assets.

**[scenario-3d] Scenario: Comparing generative 3D models.** https://help.scenario.com/en/articles/comparing-generative-3d-models/
- Comparativa de topología entre Meshy, Tripo, Hunyuan3D y TRELLIS. Es una fuente de proveedor.

**[cinevva-pixel] Cinevva: AI pixel art generators.** https://app.cinevva.com/guides/ai-pixel-art-generators
- PixelLab y Retro Diffusion producen PNG sobre una grilla real, con animación. Es un proveedor afiliado.

---

## 4. Huecos en la literatura (contribución posible del artículo)

No encontré ningún trabajo que:
1. Compare **tres vías** (files / hybrid / code) con la misma escena.
2. Mida en un **móvil real**: todos los benchmarks encontrados son de escritorio.
3. Incluya **texturas** (procedural contra PNG contra KTX2) y mida VRAM.
4. Pruebe con **red limitada** o CDN.
5. Mida **frames sin vsync** con temporizadores de GPU.
6. Cruce el costo de **creación** (facilidad de edición, costo del LLM) con el de **runtime**.

---

## 5. Protocolo para comparar correctamente

1. **Equivalencia visual.** Las variantes deben verse iguales: diff de capturas por debajo de un umbral. Si no pasan, no se comparan (WorldBench muestra que el código no garantiza lo que se ve).
2. **Mismas buenas prácticas** (instancing y merge) en todas las variantes. Si no, se mide la implementación y no el formato.
3. **Fases separadas:** descarga → parseo/decodificación → construcción → subida a GPU → primer frame → estado estable.
4. **Frío y caliente**, cada uno con red sin límite y con red 4G limitada.
5. **Frames sin tope** (`--disable-gpu-vsync --disable-frame-rate-limit`) y temporizadores de GPU (`timestamp-query` en WebGPU o `EXT_disjoint_timer_query_webgl2`).
6. **Al menos 30 repeticiones por celda**, en orden aleatorio. Reportar mediana, IQR e intervalo de confianza al 95% por bootstrap.
7. **Dos estudios:**
   - *Controlado:* la misma geometría en las 3 variantes, para aislar el efecto del formato.
   - *Real:* assets CC0 (Kenney o Quaternius) en GLB contra código de LLM que los imita.
8. **Registrar** el hardware, las versiones del navegador y de three.js, y el backend (WebGL2 o WebGPU).

### Métricas propuestas

| Métrica | Cómo | Por qué |
|---|---|---|
| Bytes transferidos (gzip/brotli) | CDP `Network` | Es la ventaja declarada de C. |
| Tiempo por fase (ms) | `performance.mark` y `measure` | Ubica dónde se va el costo; en §2.1 fue la construcción. |
| Primer frame (ms), en frío y en caliente | Fin del trabajo de GPU tras el primer render | Arranque percibido. |
| Frame time p50/p95/p99 sin vsync | RAF sin tope y temporizador de GPU | Evita el tope de 16,7 ms de `[dev2026procedural]`. |
| Draw calls y triángulos | `renderer.info` | Comprueba que la comparación es justa (regla 2). |
| Heap de JS | `performance.measureUserAgentSpecificMemory()` (requiere COOP/COEP) | Costo en RAM, como en .kkrieger. |
| VRAM estimada | Suma de buffers y texturas, con su formato | Texturas procedurales contra KTX2. |
| Facilidad de edición (opcional) | Tokens o líneas de diff para 3 ediciones estándar | El lado de la creación. |

---

## 6. Advertencias sobre las fuentes

- **Datos de proveedores:** varias comparativas (Scenario, Cinevva, 3JSBench) son de proveedores. Úsalas como contexto, no como evidencia central.
- **Un solo autor:** `[dev2026procedural]` y WorldBench son de un único autor y con pocas corridas. Sirven como antecedente, no como verdad establecida.
- **Cifras sin fuente primaria:** las de .kkrieger (unos 300 MB de RAM) y el 64% de artistas de GDC vienen de fuentes secundarias.
- **Cifras distintas para 3DCodeVerse:** el 90% del paper y el 79% de la divulgación son comparaciones diferentes. Cita la del paper.
- **Fechas:** muchas fuentes son de 2026. Conviene reverificar las versiones (arXiv v2 y siguientes) antes de enviar el artículo.

---

## 7. Fuentes técnicas para decisiones del proyecto (no para el artículo)

- pnpm, supply chain security (sin scripts de instalación de dependencias, `minimumReleaseAge`): https://pnpm.io/10.x/supply-chain-security y https://pnpm.io/blog/2025/12/29/pnpm-in-2025
- Socket, pnpm 10.16 y `minimumReleaseAge`: https://socket.dev/blog/pnpm-10-16-adds-new-setting-for-delayed-dependency-updates
- Tauri, problemas gráficos en Linux (WebKitGTK y WebGL): https://v2.tauri.app/develop/debug/linux-graphics/

---

## 8. Motivación anecdótica

- **[rieseberg2026fable]** Post en X de Felix Rieseberg sobre un shooter 3D hecho con Fable 5.2 "sin ningún GLB, todo con código": https://x.com/felixrieseberg/status/2119925633564463609
- **No se pudo verificar:** X devuelve HTTP 402 sin sesión iniciada, y no encontré cobertura secundaria.
- Hay que citarlo como anécdota que motiva la pregunta, no como evidencia. Antes de publicar, toma una captura con la fecha y archívala, por ejemplo en web.archive.org.

---

## 9. Observaciones propias con meshcode (preliminares, no son el benchmark)

Mediciones del 2026-11-20 con meshcode v0.0.0 (three.js 0.187.0, Chrome 158 headless). Son tamaños de archivo, no de rendimiento en runtime, que se medirá en la fase 5.

| Modelo | GLB | Código generado | Texturas | Geometría como | IoU / materiales |
|---|---|---|---|---|---|
| `test/fixtures/instanced.js` (6 cajas instanciadas; antes `examples/crates.js`) | 2,9 KB (meshopt: 4,5 KB) | 0,9 KB | — | primitivas | 1,0000 / idénticos |
| `test/fixtures/primitives.js` (caja + cilindro + cono, textura 64×64; antes `examples/torch.js`) | 8,2 KB (meshopt: 7,0 KB) | 1,5 KB | 1 PNG | primitivas | 1,0000 / idénticos |
| Lantern (Khronos Sample Assets, CC0, 5.394 tris) | 9.564.264 B | 311.210 B | 9.329.347 B (4 PNG, bytes originales) | datos base64 | 1,0000 / idénticos |
| Avocado (Khronos Sample Assets, CC0, 682 tris) | 8.110.040 B | 33.198 B | 8.084.902 B (3 PNG) | datos base64 | 1,0000 / idénticos |

Lecturas que habrá que confirmar:
1. **Lo que pesa en un asset de artista son las texturas, no la geometría:** el 97,5% del GLB en Lantern y el 99,7% en Avocado. Pasar la geometría a código no cambia ese tamaño; las texturas siguen siendo archivos, es decir, el modelo híbrido (B).
2. **Si la geometría coincide con primitivas, el código es mucho más pequeño:** crates pasa de 2,9 KB a 0,9 KB. **Si no coincide**, los datos en código ocupan unas 1,3 veces más que el binario, por la sobrecarga de base64 (Lantern: unos 235 KB de geometría en el GLB contra 311 KB de JS).
3. **meshopt no siempre reduce el tamaño:** en mallas diminutas (crates) lo que añade la extensión supera lo que comprime.
4. **El IoU de silueta no detecta errores de sombreado.** Ejemplo: `normalScale.y` invertido por GLTFLoader cuando la malla no tiene tangentes. Por eso la verificación compara también los materiales (`materialDiff`). Conviene mencionarlo como amenaza a la validez de cualquier métrica que solo mida la forma.

### 9.1 Ejemplos 2D: código frente a PNG (2026-11-20, mismas versiones)

| Ejemplo | Fuente (código) | PNG generado | Relación PNG/código | Nota |
|---|---|---|---|---|
| `adventurer-walk.js` (pixel art, 8 frames, 512×64) | 3,1 KB | 2,7 KB | 0,9× | El pixel art con pocos colores comprime tan bien que el PNG pesa **menos** que el código. |
| `cobblestone-texture.js` (256×256, ruido Voronoi) | 2,1 KB | 127,2 KB | ~60× | Las texturas ruidosas son el caso más favorable al código. |
| `parallax-layers.js` (3 capas de 512×192) | 3,0 KB | 61,4 KB | ~20× | Degradados y crestas: el código describe en pocas líneas lo que ocupa muchos píxeles. |
| `item-icons.svg` (384×128) | 2,8 KB | 26,7 KB | ~10× | El vector sigue escalando sin pérdida; el PNG queda fijo a una resolución. |
| `ui-kit.html` (512×256) | 2,3 KB | 24,3 KB | ~11× | Solo CSS. |

Lectura a confirmar en la fase 5:
- El tamaño favorece al código **excepto en el pixel art**.
- Generar en runtime cuesta CPU, por ejemplo el Voronoi recorre cada píxel contra cada piedra.
- Es la misma tensión entre bytes y construcción que en 3D (§2.1–2.2).
