// Measurement harness, PC (phase 5): pnpm bench:run [--reps 30] [--seconds 5] [--study load,runtime] [--set controlled,real]
// Measures only the configurations the visual gates admitted (results/equivalence.json, equivalence-real.json).
//
// Chrome runs headless on the real GPU (ANGLE over OpenGL; the run aborts if it falls back to SwiftShader),
// with vsync and the frame-rate limit off. The site is served by a local HTTP server with precompressed
// bodies (brotli-11, else gzip-6) and cacheable responses, like a static host / CDN.
//
// Load study — one cold or warm page load per cell, rendering the first frame of ?freeze=6.3:
//   cold    new browser process, empty HTTP cache, Mesa's on-disk shader cache off: a first visit
//   warm    reload in the same page: HTTP, shader and code caches warm: a returning visit
//   fast4g  cold + DevTools' "Fast 4G" network (9 Mbps × 0.9 down, 1.5 Mbps × 0.9 up, 60 ms × 2.75 RTT)
//   cpu4x   cold + 4× CPU slowdown (DevTools CPU throttling): a slower machine
// Before every measurement the harness waits for the 1-minute load average to drop below --max-load (3);
// each row records the load average when it was taken (load1).
// Runtime study — ?seconds=N+1 in a 1920×1080 viewport at dpr 1 (1080p) and dpr 2 (4K, GPU stress): per-frame
// interval, CPU time (update + render submission) and GPU time (EXT_disjoint_timer_query_webgl2); the first
// second is warm-up and is dropped.
// VRAM: the amdgpu driver's per-process counter (drm-memory-vram in /proc/<pid>/fdinfo) of this run's Chrome GPU
// process — page loaded minus a blank page in the same process. Includes the canvas' MSAA back buffers.
//
// Order: every repetition shuffles its cells (seeded). Output: results/run/{loads,runtime}.csv (one row per
// run), meta.json, summary.md; per-frame raw data in results/run/raw/ (gitignored).
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const { values: args } = parseArgs({
  options: {
    reps: { type: 'string', default: '30' }, seconds: { type: 'string', default: '4' },
    study: { type: 'string', default: 'load,runtime' }, set: { type: 'string', default: 'controlled,real' },
    'max-load': { type: 'string', default: '3' },
    configs: { type: 'string' }, // ad-hoc list of page URLs instead of the admitted configurations
    out: { type: 'string', default: 'results/run' },
  },
});
const MAX_LOAD = Number(args['max-load']);
const OUT = path.join(HERE, args.out);
const REPS = Number(args.reps), SECONDS = Number(args.seconds), STUDIES = args.study.split(','), SETS = args.set.split(',');
const VIEWPORT = { width: 1920, height: 1080 };
const SEED = 2026;
const CONDITIONS = ['cold', 'warm', 'fast4g', 'cpu4x'];
const RESOLUTIONS = /** @type {const} */ ([['1080p', 1], ['4k', 2]]);
const FAST_4G = { offline: false, latency: 60 * 2.75, downloadThroughput: ((9 * 1e6) / 8) * 0.9, uploadThroughput: ((1.5 * 1e6) / 8) * 0.9 };
const GPU_ARGS = ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info'];

// ------------------------------------------------------------------ configurations (admitted by the gates)
const URLS = {
  controlled: ['code', 'hybrid?tex=png', 'hybrid?tex=webp', 'hybrid?tex=uastc', 'hybrid?tex=etc1s', 'files?tex=png', 'files?tex=webp', 'files?tex=uastc', 'files?tex=etc1s'],
  real: ['real?props=glb&tex=png', 'real?props=glb&tex=png128', 'real?props=glb&tex=uastc', 'real?props=decompiled', 'real?props=code'],
};
const name = (/** @type {string} */ c) => c.replace(/[?&](props|tex)=/g, '-');
/** @type {string[]} */ const CONFIGS = args.configs ? args.configs.split(',') : [];
if (!args.configs) for (const set of SETS) {
  const { admitted } = JSON.parse(await readFile(path.join(HERE, `results/${set === 'real' ? 'equivalence-real' : 'equivalence'}.json`), 'utf8'));
  CONFIGS.push(.../** @type {Record<string, string[]>} */ (URLS)[set].filter((u) => admitted.includes(name(u))));
}
const url = (/** @type {string} */ base, /** @type {string} */ c, /** @type {string} */ q) => `${base}${c.replace(/^(\w+)/, '$1.html')}${c.includes('?') ? '&' : '?'}${q}`;

// ------------------------------------------------------------------ helpers
const mulberry32 = (/** @type {number} */ a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const random = mulberry32(SEED);
const shuffle = (/** @type {any[]} */ xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pct = (/** @type {number[]} */ sorted, /** @type {number} */ p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);
const sortNum = (/** @type {number[]} */ xs) => [...xs].sort((a, b) => a - b);
/** Measurements need an idle machine: wait until the 1-minute load average drops below --max-load. */
let waited = 0;
async function quiet() {
  for (let logged = false; os.loadavg()[0] >= MAX_LOAD; logged = true) {
    if (!logged) console.log(`  waiting for a quiet machine (load ${os.loadavg()[0].toFixed(1)} ≥ ${MAX_LOAD})…`);
    await new Promise((ok) => setTimeout(ok, 5000));
    waited += 5;
  }
}
const r2 = (/** @type {number} */ x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : '');

// Per-process VRAM: each launch carries a unique marker switch; its GPU process is the --type=gpu-process descendant.
let launches = 0;
const ps = async () => {
  /** @type {{ pid: string, ppid: string, cmd: string }[]} */ const list = [];
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const [cmd, stat] = await Promise.all([readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''), readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')]);
    if (cmd.includes('chrome')) list.push({ pid, ppid: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1], cmd });
  }
  return list;
};
/** VRAM (MiB) held by the GPU process of the browser launched with `mark`. @param {string} mark */
async function vram(mark) {
  const list = await ps(), main = list.find((p) => p.cmd.includes(mark));
  /** @type {Set<string>} */ const tree = new Set(main ? [main.pid] : []);
  for (let grew = true; grew;) { grew = false; for (const p of list) if (tree.has(p.ppid) && !tree.has(p.pid)) { tree.add(p.pid); grew = true; } }
  const gpu = list.find((p) => tree.has(p.pid) && p.cmd.includes('--type=gpu-process'));
  if (!gpu) return NaN;
  /** @type {Map<string, number>} */ const clients = new Map();
  for (const fd of await readdir(`/proc/${gpu.pid}/fdinfo`).catch(() => [])) {
    const t = await readFile(`/proc/${gpu.pid}/fdinfo/${fd}`, 'utf8').catch(() => '');
    const id = t.match(/drm-client-id:\s*(\d+)/)?.[1], kib = t.match(/drm-memory-vram:\s*(\d+)/)?.[1];
    if (id && kib) clients.set(id, Number(kib));
  }
  return clients.size ? [...clients.values()].reduce((a, b) => a + b, 0) / 1024 : NaN;
}

// ------------------------------------------------------------------ server: precompressed, cacheable
/** @type {Record<string, string>} */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary' };
/** @type {Map<string, { raw: Buffer, br: Buffer, gzip: Buffer }>} */ const files = new Map();
const t0 = performance.now();
for (const f of await readdir(DIST, { recursive: true, withFileTypes: true })) {
  if (!f.isFile()) continue;
  const full = path.join(f.parentPath, f.name), raw = await readFile(full);
  files.set('/' + path.relative(DIST, full).split(path.sep).join('/'), {
    raw, br: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }), gzip: gzipSync(raw, { level: 6 }),
  });
}
console.log(`precompressed ${files.size} files in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
/** @type {Record<string, number>} */ const encodings = {};
const server = http.createServer((req, res) => {
  const f = files.get(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (!f) return res.writeHead(404).end();
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = /\bbr\b/.test(accept) && f.br.length < f.raw.length * 0.97 ? 'br' : /\bgzip\b/.test(accept) && f.gzip.length < f.raw.length * 0.97 ? 'gzip' : 'identity';
  encodings[enc] = (encodings[enc] ?? 0) + 1;
  const body = enc === 'br' ? f.br : enc === 'gzip' ? f.gzip : f.raw;
  res.writeHead(200, {
    'content-type': MIME[path.extname(req.url?.split('?')[0] ?? '')] ?? 'application/octet-stream',
    'content-length': body.length, 'cache-control': 'public, max-age=3600', vary: 'accept-encoding',
    ...(enc === 'identity' ? {} : { 'content-encoding': enc }),
  });
  res.end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(null)));
const BASE = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`;

// ------------------------------------------------------------------ browser
const exe = process.env.MESHCODE_CHROME;
/** @param {boolean} coldShaders */
async function launch(coldShaders) {
  const mark = `--meshcode-bench=${process.pid}-${++launches}`; // unknown switch, ignored by Chrome: finds its processes
  const browser = await chromium.launch({
    ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true, args: [...GPU_ARGS, mark],
    env: { ...process.env, ...(coldShaders ? { MESA_SHADER_CACHE_DISABLE: 'true' } : {}) },
  });
  return Object.assign(browser, { mark });
}
/** Renderer string of a page; refuses software rendering. @param {import('playwright-core').Page} page */
async function checkGPU(page) {
  const r = await page.evaluate(() => {
    const gl = /** @type {WebGL2RenderingContext} */ (document.createElement('canvas').getContext('webgl2'));
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  if (/swiftshader|llvmpipe|software/i.test(r)) throw new Error(`software renderer: ${r}`);
  return r;
}

/** One measured load; returns its row. @param {string} config @param {string} condition @param {number} rep */
async function measureLoad(config, condition, rep) {
  const browser = await launch(condition !== 'warm');
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (condition === 'fast4g') { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', FAST_4G); }
    if (condition === 'cpu4x') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const target = url(BASE, config, 'freeze=6.3');
    const ready = () => page.waitForFunction(() => globalThis.__bench?.ready, null, { timeout: 120000 });
    if (condition === 'warm') { await page.goto(target); await ready(); } // first visit, not recorded
    const before = condition === 'warm' ? NaN : await vram(browser.mark); // blank page: the GPU process' baseline
    if (condition === 'warm') await page.reload(); else await page.goto(target);
    await ready();
    const after = await vram(browser.mark);
    const m = await page.evaluate(() => {
      const res = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource'));
      const nav = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
      const assets = res.filter((e) => /\/assets\/(png|webp|uastc|etc1s|png128|layout|real)|\/real\/decompiled\//.test(e.name));
      const b = /** @type {any} */ (globalThis).__bench;
      return {
        phases: b.phases, transfer: res.reduce((s, e) => s + e.transferSize, nav.transferSize), requests: res.length + 1,
        downloaded: assets.length ? Math.max(...assets.map((e) => e.responseEnd)) : 0,
        heap: /** @type {any} */ (performance).memory?.usedJSHeapSize ?? NaN,
      };
    });
    const gpu = rep === 0 ? await checkGPU(page) : '';
    const p = m.phases;
    return {
      row: { rep, config: name(config), condition, firstFrame: r2(p['first-frame']), start: r2(p.start), assets: r2(p.assets), world: r2(p.world), compiled: r2(p.compiled),
        downloaded: r2(m.downloaded), transferKB: r2(m.transfer / 1024), requests: m.requests, heapMB: r2(m.heap / 2 ** 20), vramMB: r2(after - before), load1: r2(os.loadavg()[0]) },
      gpu,
    };
  } finally {
    await browser.close();
  }
}

/** One timed run on an open browser; returns its summary row and the raw frames. */
async function measureRuntime(/** @type {Awaited<ReturnType<typeof launch>>} */ browser, /** @type {string} */ config, /** @type {string} */ res, /** @type {number} */ dpr, /** @type {number} */ rep) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    const before = await vram(browser.mark);
    await page.goto(url(BASE, config, `seconds=${SECONDS + 1}&dpr=${dpr}`));
    await page.waitForFunction(() => globalThis.__bench?.ready, null, { timeout: 120000 });
    await new Promise((ok) => setTimeout(ok, (1 + SECONDS / 2) * 1000));
    const alive = await vram(browser.mark);
    await page.waitForFunction(() => globalThis.__bench?.done, null, { timeout: (SECONDS + 60) * 1000 });
    const b = await page.evaluate(() => { const x = /** @type {any} */ (globalThis).__bench; return { frames: x.frames, cpu: x.cpu, gpu: x.gpu, timer: x.timer }; });
    // drop the first second (warm-up: JIT, first uploads, driver ramp-up)
    let skip = 0;
    for (let acc = 0; skip < b.frames.length && acc < 1000; skip++) acc += b.frames[skip];
    const frames = b.frames.slice(skip), cpu = b.cpu.slice(skip), gpu = b.gpu.slice(Math.min(skip, b.gpu.length));
    const F = sortNum(frames), C = sortNum(cpu), G = sortNum(gpu), total = frames.reduce((s, x) => s + x, 0);
    return {
      row: { rep, config: name(config), res, frames: frames.length, fps: r2((frames.length / total) * 1000),
        p50: r2(pct(F, 50)), p95: r2(pct(F, 95)), p99: r2(pct(F, 99)), cpuP50: r2(pct(C, 50)), cpuP95: r2(pct(C, 95)),
        gpuP50: r2(pct(G, 50)), gpuP95: r2(pct(G, 95)), gpuSamples: gpu.length, vramMB: r2(alive - before), load1: r2(os.loadavg()[0]) },
      raw: { rep, config: name(config), res, frames, cpu, gpu },
    };
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------------ run
await mkdir(path.join(OUT, 'raw'), { recursive: true });
const csv = (/** @type {Record<string, any>[]} */ rows) => [Object.keys(rows[0]).join(','), ...rows.map((r) => Object.values(r).join(','))].join('\n') + '\n';
const started = new Date().toISOString();
/** @type {any[]} */ const loads = [], runtime = [];
let renderer = '';
const eta = (/** @type {number} */ done, /** @type {number} */ total, /** @type {number} */ since) => `${done}/${total}, ~${Math.round(((performance.now() - since) / done) * (total - done) / 60000)} min left`;
try {
  if (STUDIES.includes('load')) {
    const cells = CONFIGS.flatMap((c) => CONDITIONS.map((k) => [c, k]));
    const since = performance.now();
    for (let rep = 0; rep < REPS; rep++) {
      for (const [config, condition] of shuffle(cells)) {
        await quiet();
        const { row, gpu } = await measureLoad(config, condition, rep);
        renderer ||= gpu;
        loads.push(row);
      }
      await writeFile(path.join(OUT, 'loads.csv'), csv(loads));
      console.log(`load rep ${rep + 1}/${REPS} (${eta((rep + 1) * cells.length, REPS * cells.length, since)})`);
    }
  }
  if (STUDIES.includes('runtime')) {
    const browser = await launch(false);
    try {
      const probe = await browser.newPage();
      renderer ||= await checkGPU(probe);
      await probe.close();
      const since = performance.now();
      for (let rep = 0; rep < REPS; rep++) {
        for (const [config, [res, dpr]] of shuffle(CONFIGS.flatMap((c) => RESOLUTIONS.map((r) => [c, r])))) {
          await quiet();
          const { row, raw } = await measureRuntime(browser, config, res, dpr, rep);
          runtime.push(row);
          await appendFile(path.join(OUT, 'raw/runtime.jsonl'), JSON.stringify(raw) + '\n');
        }
        await writeFile(path.join(OUT, 'runtime.csv'), csv(runtime));
        console.log(`runtime rep ${rep + 1}/${REPS} (${eta((rep + 1) * CONFIGS.length * RESOLUTIONS.length, REPS * CONFIGS.length * RESOLUTIONS.length, since)})`);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

// ------------------------------------------------------------------ meta + summary (medians and IQR; phase 6 adds bootstrap CIs and plots)
const version = await (async () => { const b = await launch(false); const v = b.version(); await b.close(); return v; })();
await writeFile(path.join(OUT, 'meta.json'), JSON.stringify({
  started, finished: new Date().toISOString(), chrome: version, renderer, flags: GPU_ARGS, viewport: VIEWPORT, reps: REPS, seconds: SECONDS, seed: SEED,
  configs: CONFIGS.map(name), conditions: { cold: 'new browser, Mesa shader cache off', warm: 'reload, caches warm', fast4g: FAST_4G, cpu4x: 'Emulation.setCPUThrottlingRate 4' },
  resolutions: RESOLUTIONS, maxLoad: MAX_LOAD, waitedSeconds: waited, encodings, vram: 'amdgpu drm-memory-vram of the run\'s Chrome GPU process (fdinfo), minus a blank page',
}, null, 2));

const q = (/** @type {number[]} */ xs, d = 1) => { const s = sortNum(xs.filter(Number.isFinite)); return s.length ? `${pct(s, 50).toFixed(d)} (${pct(s, 25).toFixed(d)}–${pct(s, 75).toFixed(d)})` : '—'; };
const lines = [`# Measurements — PC (${started.slice(0, 10)})`, '', `Chrome ${version}, ${renderer}. ${REPS} repetitions per cell, median (IQR). Raw rows: loads.csv, runtime.csv.`, ''];
if (loads.length) {
  lines.push('## Load: first frame (ms from navigation)', '', `| config | ${CONDITIONS.join(' | ')} | transfer KB (cold) | VRAM Δ MiB (cold) |`, `|---|${CONDITIONS.map(() => '---:').join('|')}|---:|---:|`);
  for (const c of CONFIGS.map(name)) {
    const of = (/** @type {string} */ k, /** @type {string} */ f) => loads.filter((r) => r.config === c && r.condition === k).map((r) => Number(r[f]));
    lines.push(`| ${c} | ${CONDITIONS.map((k) => q(of(k, 'firstFrame'))).join(' | ')} | ${q(of('cold', 'transferKB'))} | ${q(of('cold', 'vramMB'))} |`);
  }
  lines.push('', '## Load: assets ready (ms from navigation)', '', `| config | ${CONDITIONS.join(' | ')} |`, `|---|${CONDITIONS.map(() => '---:').join('|')}|`);
  for (const c of CONFIGS.map(name)) lines.push(`| ${c} | ${CONDITIONS.map((k) => q(loads.filter((r) => r.config === c && r.condition === k).map((r) => Number(r.assets)))).join(' | ')} |`);
}
if (runtime.length) {
  for (const [res] of RESOLUTIONS) {
    lines.push('', `## Runtime ${res}, no vsync (${SECONDS} s per run after 1 s warm-up)`, '',
      '| config | fps | frame p50 ms | frame p95 | frame p99 | CPU p50 ms | GPU p50 ms | GPU p95 | VRAM Δ MiB |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const c of CONFIGS.map(name)) {
      const rs = runtime.filter((r) => r.config === c && r.res === res), col = (/** @type {string} */ f, d = 2) => q(rs.map((r) => Number(r[f])), d);
      lines.push(`| ${c} | ${col('fps', 0)} | ${col('p50')} | ${col('p95')} | ${col('p99')} | ${col('cpuP50')} | ${col('gpuP50', 3)} | ${col('gpuP95', 3)} | ${col('vramMB', 1)} |`);
    }
  }
}
await writeFile(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
