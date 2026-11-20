// Records docs/demo.gif from the built web app: a scripted tour (3D examples, live edit, 2D mode),
// screenshots in headless Chrome, assembled with ImageMagick (`convert`, v6 or v7 via `magick`).
// Run: pnpm demo:gif
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchChrome, serve } from '../src/browser.mjs';

const OUT = 'docs/demo.gif';
const VIEWPORT = { width: 1100, height: 620 };
const SCALE = 0.8; // 880 px wide: the README column on github.com, captured at that size (no resize pass)
const MIN_FRAME_MS = 100; // ≤ 10 fps: smaller file, and ImageMagick 6 stays inside its default memory/disk policy

execFileSync('pnpm', ['-s', 'build'], { stdio: 'inherit' });
const server = await serve({ '': path.resolve('dist') });
const browser = await launchChrome();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'dark' });
const page = await context.newPage();
const sleep = (/** @type {number} */ ms) => page.waitForTimeout(ms);
const stat3d = (/** @type {string} */ name, /** @type {string} */ not) =>
  page.waitForFunction(([n, v]) => { const t = document.querySelector(`[data-stat="${n}"]`)?.textContent; return t && t !== '–' && t !== v; }, [name, not], { timeout: 30000 });

/** Drag across the viewer to orbit the camera. @param {number} dx */
async function orbit(dx, ms = 1400) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#viewer').boundingBox());
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = Math.round(ms / 50);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dx * 0.08 * i) / steps);
    await sleep(50);
  }
  await page.mouse.up();
}
/** Load an example and wait for its stats. @param {string} name @param {string} stat */
async function example(name, stat = 'triangles') {
  const before = await page.locator(`[data-stat="${stat}"]`).textContent();
  await page.selectOption('#examples', name);
  await stat3d(stat, before ?? '');
}

await page.goto(server.url);
await stat3d('triangles', '');
await sleep(500);

// Record while the tour runs; each frame keeps its real duration.
/** @type {{ t: number, png: Buffer }[]} */ const frames = [];
let recording = true;
const t0 = Date.now();
const recorder = (async () => {
  while (recording) frames.push({ t: Date.now() - t0, png: await page.screenshot() });
})();

await sleep(900);
await orbit(-260);
await sleep(500);

await example('forest');
await sleep(900);
// Live edit: a new seed is a new forest.
await page.evaluate(() => {
  const ed = globalThis.meshcodeEditor, i = ed.state.doc.toString().indexOf('SEED = 42') + 7;
  ed.focus();
  ed.dispatch({ selection: { anchor: i, head: i + 2 }, scrollIntoView: true });
});
await sleep(400);
await page.keyboard.type('1337', { delay: 140 });
await page.waitForFunction(() => /SEED = 1337/.test(globalThis.meshcodeEditor.state.doc.toString()));
await sleep(2200); // debounce + rebuild
await orbit(200, 1000);
await sleep(300);

await example('spaceship');
await sleep(600);
await orbit(-300, 1300);
await sleep(400);

await page.click('#mode-2d');
await sleep(2400); // walk cycle animates
await example('icons', 'kind');
await sleep(1200);
await example('ui', 'kind');
await sleep(1200);

recording = false;
await recorder;
await context.close();
await browser.close();
await server.close();

// Keep a frame only if it changed and enough time passed; it lasts until the next kept frame.
/** @type {{ t: number, png: Buffer }[]} */ const kept = [];
for (const f of frames) {
  const last = kept.at(-1);
  if (!last || (f.t - last.t >= MIN_FRAME_MS && !f.png.equals(last.png))) kept.push(f);
}

// Assemble: one shared 128-colour palette (sampled from every 10th frame), so unchanged pixels keep
// the same index and frame differencing only stores what moved; per-frame delays (1/100 s) from the
// real timestamps. No fuzz: on a dark UI it leaves ghosts of low-contrast edges. Target ≤ 2 MB.
const dir = await mkdtemp(path.join(tmpdir(), 'meshcode-gif-'));
/** @type {string[]} */ const files = [];
for (let i = 0; i < kept.length; i++) {
  files.push(path.join(dir, `f${String(i).padStart(4, '0')}.png`));
  await writeFile(files[i], kept[i].png);
}
const palette = path.join(dir, 'palette.png');
/** @type {string[]} */ const args = ['-loop', '0'];
kept.forEach((f, i) => {
  const next = kept[i + 1]?.t ?? (frames.at(-1)?.t ?? 0) + 1500; // the last frame holds 1.5 s
  args.push('-delay', String(Math.max(2, Math.round((next - f.t) / 10))), files[i]);
});
args.push('+dither', '-remap', palette, '-layers', 'Optimize', OUT);
const im = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); return 'magick'; } catch { return 'convert'; } })();
execFileSync(im, [...files.filter((_, i) => i % 10 === 0), '-append', '+dither', '-colors', '128', '-unique-colors', palette]);
execFileSync(im, args, { stdio: 'inherit' });
await rm(dir, { recursive: true });
console.log(`wrote ${OUT}: ${kept.length} frames, ${(frames.at(-1)?.t ?? 0) / 1000} s, ${((await stat(OUT)).size / 1024 / 1024).toFixed(2)} MB`);
