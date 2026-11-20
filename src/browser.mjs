// @ts-check
// Node side: drive headless Chrome so the CLI runs the exact browser core the web app uses.
import { access, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { generate, refine } from './core/llm.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
// three's exports map hides package.json; resolve the CJS build and walk up.
const THREE_DIR = path.resolve(createRequire(import.meta.url).resolve('three'), '../..');

const PAGE = `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="importmap">
{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}
</script>`;

/** @type {Record<string, string>} */
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary',
  '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};

/**
 * Static server on 127.0.0.1 (random port) that only serves files under `roots` (url prefix → dir).
 * The '' root serves a whole site at / (index.html); without it, / is the bare import-map page.
 * A real server, not playwright request interception: interception makes browser.close() stall 5 s,
 * and the benchmark needs genuine network timing anyway.
 * @param {Record<string, string>} roots
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serve(roots) {
  const site = roots[''];
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/' && !site) return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    try {
      let root, rel;
      if (site) {
        [root, rel] = [site, pathname === '/' ? 'index.html' : pathname.slice(1)];
      } else {
        const [, prefix, ...rest] = pathname.split('/');
        if (!Object.hasOwn(roots, prefix)) throw new Error('unknown root');
        [root, rel] = [roots[prefix], rest.join('/')];
      }
      const file = path.resolve(root, decodeURIComponent(rel));
      // Path-traversal guard: never serve anything outside the declared roots.
      if (!file.startsWith(root + path.sep)) throw new Error('outside roots');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((ok) => server.close(() => ok())) };
}

/** Headless Google Chrome (or MESHCODE_CHROME). Close its contexts before the browser, see withPage. */
export async function launchChrome() {
  const exe = process.env.MESHCODE_CHROME;
  try {
    return await chromium.launch(exe ? { executablePath: exe } : { channel: 'chrome' });
  } catch (err) {
    throw new Error(`could not start Chrome (install Google Chrome or set MESHCODE_CHROME): ${/** @type {Error} */ (err).message.split('\n')[0]}`);
  }
}

/**
 * Open a page whose origin only serves three.js, src/, and `extraRoots`.
 * @template T
 * @param {Record<string, string>} extraRoots url prefix → directory, e.g. { model: '/abs/dir' }
 * @param {(page: import('playwright-core').Page) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withPage(extraRoots, fn) {
  const browser = await launchChrome();
  const server = await serve({ three: THREE_DIR, meshcode: SRC_DIR, ...extraRoots });
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      // Binary transport across page.evaluate, which only carries JSON.
      /** @param {ArrayBuffer} buf */
      globalThis.__toB64 = (buf) => {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      /** @param {string} b64 */
      globalThis.__fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.error(`[page] ${err.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.error(`[page] ${msg.text()}`); });
    await page.goto(server.url);
    return await fn(page);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
}

/**
 * Run a model module in Chrome and export it as GLB.
 * @param {string} modelPath file with `export default (THREE) => Object3D`
 * @returns {Promise<{ glb: Buffer, stats: Stats }>}
 */
export async function buildFile(modelPath) {
  const abs = path.resolve(modelPath);
  await access(abs); // fail fast with ENOENT instead of a browser fetch error
  return withPage({ model: path.dirname(abs) }, async (page) => {
    const r = await page.evaluate(async (name) => {
      const core = await import('/meshcode/core/glb.js');
      const mod = await import(`/model/${encodeURIComponent(name)}`);
      const root = await core.runModel(mod.default);
      return { b64: globalThis.__toB64(await core.exportGLB(root)), stats: core.sceneStats(root) };
    }, path.basename(abs));
    return { glb: Buffer.from(r.b64, 'base64'), stats: r.stats };
  });
}

/**
 * Load a GLB in Chrome (meshopt supported) and report its stats.
 * @param {Uint8Array} glb
 * @returns {Promise<Stats>}
 */
export async function inspectGLB(glb) {
  return withPage({}, (page) => page.evaluate(async (b64) => {
    const core = await import('/meshcode/core/glb.js');
    return core.sceneStats(await core.loadGLB(globalThis.__fromB64(b64)));
  }, Buffer.from(glb).toString('base64')));
}

/**
 * Silhouette IoU and material differences between two model files (.glb or model module), plus both stats.
 * @param {string} a @param {string} b
 * @returns {Promise<{ mean: number, min: number, views: number[], materials: string[], a: Stats, b: Stats }>}
 */
export async function verifyFiles(a, b) {
  const [A, B] = [path.resolve(a), path.resolve(b)];
  await Promise.all([access(A), access(B)]);
  const url = (/** @type {string} */ root, /** @type {string} */ f) => `/${root}/${encodeURIComponent(path.basename(f))}`;
  return withPage({ a: path.dirname(A), b: path.dirname(B) }, (page) => page.evaluate(async ([ua, ub]) => {
    const core = await import('/meshcode/core/glb.js');
    const { materialDiff, silhouetteIoU } = await import('/meshcode/core/fidelity.js');
    const [ma, mb] = await Promise.all([core.loadModelURL(ua), core.loadModelURL(ub)]);
    return { ...silhouetteIoU(ma, mb), materials: materialDiff(ma, mb), a: core.sceneStats(ma), b: core.sceneStats(mb) };
  }, [url('a', A), url('b', B)]));
}

/**
 * GLB → model module (+ texture files next to it), then rebuild it and measure fidelity.
 * @param {string} glbPath @param {string} outPath
 */
export async function decompileFile(glbPath, outPath) {
  const glb = await readFile(glbPath);
  const outDir = path.dirname(path.resolve(outPath));
  const base = path.basename(outPath).replace(/\.[cm]?js$/, '');
  const r = await withPage({}, (page) => page.evaluate(async ({ b64, base, source }) => {
    const core = await import('/meshcode/core/glb.js');
    const { decompile } = await import('/meshcode/core/decompile.js');
    return decompile(await core.loadGLB(globalThis.__fromB64(b64)), { textureFile: (i, ext) => `${base}.tex${i}.${ext}`, source });
  }, { b64: glb.toString('base64'), base, source: path.basename(glbPath) }));
  await Promise.all(r.textures.map((t) => writeFile(path.join(outDir, t.file), Buffer.from(t.data, 'base64'))));
  await writeFile(outPath, r.code);
  return { code: r.code, textureFiles: r.textures.map((t) => t.file), summary: r.summary, warnings: r.warnings, fidelity: await verifyFiles(glbPath, outPath) };
}

/**
 * Render 2D source (canvas module, SVG or HTML) in Chrome and encode it.
 * @param {string} input source file @param {'image/png' | 'image/jpeg' | 'image/webp'} type @param {number} [quality]
 */
export async function buildImageFile(input, type, quality = 0.92) {
  const code = await readFile(input, 'utf8');
  const r = await withPage({}, (page) => page.evaluate(async ({ code, type, quality }) => {
    const img = await import('/meshcode/core/image.js');
    const out = await img.renderImage(code);
    return {
      b64: globalThis.__toB64(await img.encodeImage(out.canvas, type, quality)),
      meta: { kind: out.kind, width: out.width, height: out.height, frames: out.frames, columns: out.columns,
        sheetWidth: out.canvas.width, sheetHeight: out.canvas.height, coverage: img.coverage(out.canvas) },
    };
  }, { code, type, quality }));
  return { bytes: Buffer.from(r.b64, 'base64'), meta: r.meta };
}

/**
 * Export a model (.js module or .glb) as engine-native source.
 * Also returns each mesh's world AABB in three.js, in scene order, to validate the result in the engine.
 * @param {string} input @param {'godot' | 'unity'} engine
 */
export async function exportEngineFile(input, engine) {
  const abs = path.resolve(input);
  await access(abs);
  return withPage({ model: path.dirname(abs) }, (page) => page.evaluate(async ({ file, engine }) => {
    const THREE = await import('three');
    const core = await import('/meshcode/core/glb.js');
    const engines = await import('/meshcode/core/engines.js');
    const root = await core.loadModelURL(`/model/${encodeURIComponent(file)}`);
    const out = (engine === 'godot' ? engines.toGodot : engines.toUnity)(root, { source: file });
    /** @type {{ name: string, min: number[], max: number[] }[]} */
    const boxes = [];
    root.traverse((o) => {
      const m = /** @type {any} */ (o);
      if (!m.isMesh) return;
      if (m.isInstancedMesh) m.computeBoundingBox();
      else m.geometry.computeBoundingBox();
      const box = (m.isInstancedMesh ? m.boundingBox : m.geometry.boundingBox).clone().applyMatrix4(m.matrixWorld);
      const g = m.geometry;
      boxes.push({ name: m.name, min: box.min.toArray(), max: box.max.toArray(), triangles: (g.index ? g.index.count : g.attributes.position.count) / 3 });
    });
    return { ...out, boxes };
  }, { file: path.basename(abs), engine }));
}

/**
 * What the AI loops need, backed by a headless page: run a candidate, snapshot the last good one,
 * verify one against the GLB loaded as globalThis.__orig.
 * @param {import('playwright-core').Page} page @param {'3d' | '2d'} mode
 */
function aiTools(page, mode) {
  const fail = (/** @type {any} */ e) => ({ error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` });
  return {
    run: (/** @type {string} */ code) => page.evaluate(async ({ code, mode }) => {
      try {
        if (mode === '2d') {
          const img = await import('/meshcode/core/image.js');
          const out = await img.renderImage(code);
          globalThis.__last = out.canvas;
          return { empty: img.coverage(out.canvas) === 0 };
        }
        const core = await import('/meshcode/core/glb.js');
        globalThis.__last = await core.runSource(code);
        return { empty: core.sceneStats(globalThis.__last).triangles === 0 };
      } catch (e) {
        return { error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` };
      }
    }, { code, mode }).catch(fail),
    capture: () => page.evaluate(async (mode) => {
      const views = await import('/meshcode/core/views.js');
      return mode === '2d' ? views.imageView(globalThis.__last) : views.renderViews(globalThis.__last);
    }, mode),
    verify: (/** @type {string} */ code) => page.evaluate(async (code) => {
      try {
        const core = await import('/meshcode/core/glb.js');
        const { materialDiff, silhouetteIoU } = await import('/meshcode/core/fidelity.js');
        const root = await core.runSource(code);
        return { mean: silhouetteIoU(globalThis.__orig, root).mean, materials: materialDiff(globalThis.__orig, root) };
      } catch (e) {
        return { error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` };
      }
    }, code).catch(fail),
  };
}

/**
 * AI: write a model (or 2D image) from a description; every candidate runs in headless Chrome.
 * @param {Omit<Parameters<typeof generate>[0], 'run' | 'capture'>} opts
 */
export function generateWithLLM(opts) {
  return withPage({}, (page) => {
    const t = aiTools(page, opts.mode);
    return generate({ ...opts, run: t.run, capture: t.capture });
  });
}

/**
 * AI: GLB → deterministic code (textures inline, one file) → readable rewrite, accepted only if it
 * matches the GLB. Without a match, the deterministic code comes back.
 * @param {string} glbPath @param {Omit<Parameters<typeof refine>[0], 'code' | 'verify'>} opts
 */
export async function refineGLB(glbPath, opts) {
  const glb = await readFile(glbPath);
  return withPage({}, async (page) => {
    const code = await page.evaluate(async ({ b64, source }) => {
      const core = await import('/meshcode/core/glb.js');
      const { decompile } = await import('/meshcode/core/decompile.js');
      globalThis.__orig = await core.loadGLB(globalThis.__fromB64(b64));
      return (await decompile(globalThis.__orig, { inlineTextures: true, source })).code;
    }, { b64: glb.toString('base64'), source: path.basename(glbPath) });
    return refine({ ...opts, code, verify: aiTools(page, '3d').verify });
  });
}

/** @typedef {{ meshes: number, instances: number, triangles: number, min: number[], max: number[] }} Stats */
