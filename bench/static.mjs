// Static comparison (pnpm bench:static): what each variant downloads, what it puts on the GPU, and a
// first, preliminary look at load phases. Run bench:build first. Frame-time and GPU-time measurements
// with the real GPU, network throttling and ≥ 30 randomized repetitions are phase 5's harness.
//   node bench/static.mjs [--reps 5]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { launchChrome, serve } from '../src/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const CONFIGS = ['code', 'hybrid?tex=uastc', 'hybrid?tex=etc1s', 'hybrid?tex=webp', 'hybrid?tex=png', 'files?tex=uastc', 'files?tex=etc1s', 'files?tex=webp', 'files?tex=png'];
const { values } = parseArgs({ options: { reps: { type: 'string', default: '5' } } });
const REPS = Number(values.reps);

const kind = (/** @type {string} */ f) => (/\.(js|html|wasm)$/.test(f) ? 'code' : /\.glb$/.test(f) ? 'models' : /\.json$/.test(f) ? 'layout' : 'effects');
/** @type {Map<string, { raw: number, gzip: number, br: number }>} */ const sizes = new Map();
async function sizeOf(/** @type {string} */ file) {
  if (!sizes.has(file)) {
    const body = await readFile(path.join(DIST, file));
    sizes.set(file, {
      raw: body.length,
      gzip: gzipSync(body, { level: 6 }).length, // a typical server
      br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, // precompressed static files
    });
  }
  return /** @type {{ raw: number, gzip: number, br: number }} */ (sizes.get(file));
}
const median = (/** @type {number[]} */ xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const server = await serve({ '': DIST });
const browser = await launchChrome();
/** @type {Record<string, any>} */ const out = {};
let gpu = '';
try {
  for (let rep = 0; rep < REPS; rep++) {
    for (const config of rep % 2 ? [...CONFIGS].reverse() : CONFIGS) { // alternate the order between repetitions
      const context = await browser.newContext({ viewport: { width: 960, height: 540 } }); // fresh: cold cache
      const page = await context.newPage();
      /** @type {string[]} */ const files = [];
      page.on('requestfinished', (r) => { // network requests only (GLTFLoader also fetches blob: URLs of embedded images)
        if (r.url().startsWith(server.url)) files.push(decodeURIComponent(new URL(r.url()).pathname.slice(1)) || 'index.html');
      });
      const sep = config.includes('?') ? '&' : '?';
      await page.goto(`${server.url}${config.replace(/^(\w+)/, '$1.html')}${sep}freeze=6.3`);
      await page.waitForFunction(() => globalThis.__bench?.ready, null, { timeout: 60000 });
      const r = await page.evaluate(() => {
        const assets = performance.getEntriesByType('resource').filter((e) => /\/assets\/(png|webp|uastc|etc1s|layout)/.test(e.name));
        return {
          ...globalThis.__bench, read: undefined,
          downloaded: assets.length ? Math.max(...assets.map((e) => /** @type {PerformanceResourceTiming} */ (e).responseEnd)) : 0,
          heap: /** @type {any} */ (performance).memory?.usedJSHeapSize ?? 0,
        };
      });
      gpu ||= await page.evaluate(() => {
        const gl = /** @type {WebGL2RenderingContext} */ (document.createElement('canvas').getContext('webgl2'));
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
      await context.close();
      const o = (out[config] ??= { reps: [], files: [] });
      o.reps.push({ ...r.phases, downloaded: r.downloaded, heap: r.heap, generate: r.generate });
      if (rep === 0) Object.assign(o, { files, render: r.render, memory: r.memory });
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const kb = (/** @type {number} */ n) => (n / 1024).toFixed(1);
const mb = (/** @type {number} */ n) => (n / 1024 / 1024).toFixed(2);
const label = (/** @type {string} */ c) => c.replace('?tex=', ' · ');
const transfer = [], scene = [], load = [];
for (const config of CONFIGS) {
  const o = out[config];
  /** @type {Record<string, { raw: number, gzip: number, br: number }>} */ const by = {};
  const total = { raw: 0, gzip: 0, br: 0 };
  for (const f of o.files) {
    const s = await sizeOf(f), k = kind(f);
    by[k] ??= { raw: 0, gzip: 0, br: 0 };
    for (const key of /** @type {const} */ (['raw', 'gzip', 'br'])) { by[k][key] += s[key]; total[key] += s[key]; }
  }
  o.transfer = { by, total, requests: o.files.length };
  const cell = (/** @type {string} */ k) => (by[k] ? `${kb(by[k].raw)} / ${kb(by[k].br)}` : '—');
  transfer.push(`| ${label(config)} | ${o.files.length} | ${cell('code')} | ${cell('models')} | ${cell('effects')} | ${cell('layout')} | **${kb(total.raw)}** | ${kb(total.gzip)} | **${kb(total.br)}** |`);
  const m = o.memory, rd = o.render;
  scene.push(`| ${label(config)} | ${rd.calls} | ${rd.triangles.toLocaleString('en')} | ${rd.programs} | ${m.geometries} | ${m.textures} | ${mb(m.geometryBytes)} | ${mb(m.textureBytes)} | ${m.compressedFormats?.join(', ') || 'RGBA8'} |`);
  const col = (/** @type {string} */ k) => { const xs = o.reps.map((/** @type {any} */ r) => r[k]); return `${median(xs).toFixed(0)} (${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)})`; };
  const span = (/** @type {string} */ a, /** @type {string} */ b) => { const xs = o.reps.map((/** @type {any} */ r) => r[b] - r[a]); return `${median(xs).toFixed(0)}`; };
  load.push(`| ${label(config)} | ${o.reps[0].downloaded ? col('downloaded') : '—'} | ${col('assets')} | ${span('start', 'assets')} | ${span('assets', 'world')} | ${span('world', 'compiled')} | ${span('compiled', 'first-frame')} | **${col('first-frame')}** | ${mb(median(o.reps.map((/** @type {any} */ r) => r.heap)))} |`);
}

const md = `# Static comparison

Generated by \`pnpm bench:static\` (${new Date().toISOString().slice(0, 10)}). Headless Chrome, renderer: \`${gpu}\`.
Variants: **code** = everything generated at runtime; **hybrid** = models + textures as GLB files, layout and effects as code;
**files** = models, textures, effects (flipbook + sprite) and layout all downloaded. \`png\` / \`webp\` / \`uastc\` / \`etc1s\`: texture format inside the GLBs and of the effect images (the last two are KTX2 / Basis Universal).

## 1. What each variant downloads (KB: raw / brotli-11)

| variant | requests | code (HTML+JS) | models (GLB) | effects (images) | layout (JSON) | total raw | total gzip-6 | total brotli |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${transfer.join('\n')}

## 2. What each variant puts on the GPU (first frame)

Draw calls and triangles include the shadow-map pass. Bytes are estimates: unique vertex/index/instance buffers; PNG/WebP/canvas textures at 4 bytes per texel (+⅓ with mipmaps);
KTX2 textures at the size of their transcoded blocks (mip chain included). The transcode target depends on the GPU's extensions.

| variant | draw calls | triangles | programs | geometries | textures | geometry MB | texture MB | GPU texture format |
|---|---:|---:|---:|---:|---:|---:|---:|---|
${scene.join('\n')}

## 3. Load phases — preliminary (ms from navigation; median (min–max) of ${REPS} cold loads)

**Not the study's timing data**: local server (no network latency), ${REPS} repetitions, and the renderer above. Phase 5 measures with the real GPU, throttled network and ≥ 30 randomized repetitions.
"assets ready" = downloaded and decoded/parsed (files) or generated (code); "start→assets" is that span from the game's first line.

| variant | last asset downloaded | assets ready | start→assets | build scene | compile shaders | first frame (upload + draw) | **first frame at** | JS heap MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${load.join('\n')}
`;
const gen = out.code.reps.map((/** @type {any} */ r) => r.generate);
const genTable = Object.keys(gen[0]).map((k) => `| ${k} | ${median(gen.map((/** @type {any} */ g) => g[k])).toFixed(1)} |`).join('\n');
const md2 = `${md}
## 4. Code variant: generation time per asset (ms, median of ${REPS})

What the code variant does instead of downloading: building geometry and drawing canvas textures (per-pixel grain included).

| asset | ms |
|---|---:|
${genTable}
`;
await writeFile(path.join(HERE, 'results/static.md'), md2);
await writeFile(path.join(HERE, 'results/static.json'), JSON.stringify({ gpu, reps: REPS, results: out }, null, 2));
console.log(md2);
