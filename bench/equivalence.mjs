// Visual equivalence gate (protocol rule 1, pnpm bench:check): configurations are compared only if they look
// the same. Failing ones are listed as excluded (results/equivalence.json → admitted / excluded); the run
// exits 1 only if the negative control passes. Every page renders the same instants (?freeze) at 960×540, dpr 1; frames are read back as
// RGBA and compared with the code variant, the source of truth. Run bench:build first.
// Thresholds were fixed before the first run (see research/bitacora.md):
//   scene only (?novfx): PSNR ≥ 35 dB and ≥ 99 % of pixels within ±8 levels on every channel
//   with effects:        PSNR ≥ 30 dB and ≥ 97 %  (flipbooks sample the effect at 64 discrete ages)
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, serve } from '../src/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const TIMES = [3.0, 6.3, 11.7, 19.2];
const FIGURE_T = 6.3; // instant saved as images for the article
const CONFIGS = ['code', 'hybrid?tex=png', 'hybrid?tex=webp', 'hybrid?tex=uastc', 'hybrid?tex=etc1s', 'files?tex=png', 'files?tex=webp', 'files?tex=uastc', 'files?tex=etc1s'];
const GATE = { scene: { psnr: 35, within: 0.99 }, vfx: { psnr: 30, within: 0.97 } };
const TOLERANCE = 8;

/** @param {Buffer} a @param {Buffer} b */
function compare(a, b) {
  let sq = 0, within = 0, abs = 0;
  for (let i = 0; i < a.length; i += 4) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c];
      sq += d * d;
      abs += Math.abs(d);
      worst = Math.max(worst, Math.abs(d));
    }
    if (worst <= TOLERANCE) within++;
  }
  const n = a.length / 4, mse = sq / (n * 3);
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), within: within / n, meanAbs: abs / (n * 3) };
}

const server = await serve({ '': path.join(HERE, 'dist') });
const browser = await launchChrome();
await mkdir(path.join(RESULTS, 'frames'), { recursive: true });
/** @type {Record<string, Record<string, Buffer>>} */ const frames = {};
const name = (/** @type {string} */ c) => c.replace('?tex=', '-');
try {
  for (const scene of [true, false]) {
    for (const config of CONFIGS) {
      const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
      const page = await context.newPage();
      page.on('pageerror', (e) => console.error(`[${config}] ${e.message}`));
      const sep = config.includes('?') ? '&' : '?';
      await page.goto(`${server.url}${config.replace(/^(\w+)/, '$1.html')}${sep}freeze=${TIMES[0]}${scene ? '&novfx' : ''}`);
      await page.waitForFunction(() => globalThis.__bench?.ready, null, { timeout: 60000 });
      for (const t of TIMES) {
        const { rgba } = await page.evaluate((t) => globalThis.__bench.read(t), t);
        frames[`${scene}:${t}`] ??= {};
        frames[`${scene}:${t}`][config] = Buffer.from(rgba, 'base64');
        if (t === FIGURE_T && !scene) await page.locator('canvas').screenshot({ path: path.join(RESULTS, 'frames', `${name(config)}.png`) });
      }
      if (config === 'code') { // negative control: one frame (1/60 s) later must NOT pass
        const { rgba } = await page.evaluate((t) => globalThis.__bench.read(t), FIGURE_T + 1 / 60);
        frames[`${scene}:${FIGURE_T}`]['code +1 frame'] = Buffer.from(rgba, 'base64');
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

/** @type {any[]} */ const rows = [];
for (const [key, byConfig] of Object.entries(frames)) {
  const [scene, t] = key.split(':');
  for (const config of [...CONFIGS.slice(1), ...(byConfig['code +1 frame'] ? ['code +1 frame'] : [])]) {
    const r = compare(byConfig.code, byConfig[config]);
    const gate = scene === 'true' ? GATE.scene : GATE.vfx;
    rows.push({ config: name(config), effects: scene === 'false', t: Number(t), ...r, pass: r.psnr >= gate.psnr && r.within >= gate.within, control: config === 'code +1 frame' });
  }
}
const pct = (/** @type {number} */ x) => `${(x * 100).toFixed(2)} %`;
const db = (/** @type {number} */ x) => (x === Infinity ? '∞' : `${x.toFixed(1)} dB`);
const lines = [
  '# Visual equivalence gate',
  '',
  `Reference: \`code\` variant. 960×540, dpr 1, headless Chrome. Instants: ${TIMES.join(', ')} s. Tolerance: ±${TOLERANCE} levels per channel.`,
  `Pass: scene only PSNR ≥ ${GATE.scene.psnr} dB and ≥ ${GATE.scene.within * 100} % within tolerance; with effects PSNR ≥ ${GATE.vfx.psnr} dB and ≥ ${GATE.vfx.within * 100} %.`,
  '',
  '| variant | effects | t (s) | PSNR | pixels within ±8 | mean abs diff | pass |',
  '|---|---|---:|---:|---:|---:|---|',
  ...rows.sort((a, b) => a.config.localeCompare(b.config) || a.effects - b.effects || a.t - b.t)
    .map((r) => `| ${r.config} | ${r.effects ? 'yes' : 'no'} | ${r.t} | ${db(r.psnr)} | ${pct(r.within)} | ${r.meanAbs.toFixed(3)} | ${r.control ? (r.pass ? '⚠️ control passed' : 'fails, as it must') : r.pass ? '✅' : '❌'} |`),
  '',
  '`code +1 frame` is a negative control: the same variant 1/60 s later. It must fail, which shows the gate can tell apart',
  'two renders that differ by one frame of motion.',
];
const failed = rows.filter((r) => !r.pass && !r.control);
const leaked = rows.filter((r) => r.pass && r.control); // the gate must be able to fail
const excluded = [...new Set(failed.map((r) => r.config))];
const admitted = ['code', ...CONFIGS.slice(1).map(name).filter((c) => !excluded.includes(c))]; // phase 5 measures only these
lines.push('', `**Admitted** (measured in phase 5): ${admitted.join(', ')}.`, excluded.length ? `**Excluded** (fail the gate): ${excluded.join(', ')}.` : '');
await writeFile(path.join(RESULTS, 'equivalence.md'), lines.join('\n') + '\n');
await writeFile(path.join(RESULTS, 'equivalence.json'), JSON.stringify({ admitted, excluded, rows }, (k, v) => (v === Infinity ? null : v), 2));
// Figures for the article: code | variant | their difference ×10 (ImageMagick, optional).
try {
  const f = (/** @type {string} */ n) => path.join(RESULTS, 'frames', `${n}.png`);
  for (const [variant, figure] of [['files-webp', 'figure-equivalence.png'], ['files-etc1s', 'figure-etc1s.png']]) {
    const diff = f(`diff-${variant}`);
    execFileSync('convert', [f('code'), f(variant), '-compose', 'difference', '-composite', '-evaluate', 'multiply', '10', diff]);
    execFileSync('convert', [f('code'), f(variant), diff, '-resize', '640x', '+append', path.join(RESULTS, figure)]);
  }
} catch {
  console.log('(ImageMagick `convert` not found: figures skipped)');
}

// A failing configuration is a result, not an error: it is excluded from timing comparisons (phase 5).
// The run itself fails only if the negative control passes, i.e. the gate cannot tell frames apart.
console.log(lines.slice(5).join('\n'));
console.log(`\nadmitted: ${admitted.join(', ')}`);
if (excluded.length) console.log(`EXCLUDED (not visually equivalent): ${excluded.join(', ')}`);
if (leaked.length) console.log('\nNEGATIVE CONTROL PASSED: the gate is too lenient');
process.exitCode = leaked.length ? 1 : 0;
