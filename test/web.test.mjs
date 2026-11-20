// End-to-end: the built web app in headless Chrome (WebGL via SwiftShader).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import validator from 'gltf-validator';
import { buildFile, inspectGLB, launchChrome, serve } from '../src/browser.mjs';

/** @type {Awaited<ReturnType<typeof serve>>} */ let server;
/** @type {import('playwright-core').Browser} */ let browser;
/** @type {import('playwright-core').BrowserContext} */ let context;
/** @type {import('playwright-core').Page} */ let page;
/** @type {string[]} */ const pageErrors = [];

const stat = (/** @type {string} */ name) => page.locator(`[data-stat="${name}"]`);
const code = () => page.evaluate(() => globalThis.meshcodeEditor.state.doc.toString());
/** Wait until the viewer reports stats for the current code. */
const statsReady = (/** @type {string} */ triangles) =>
  page.waitForFunction((t) => document.querySelector('[data-stat="triangles"]')?.textContent === t, triangles, { timeout: 20000 });

before(async () => {
  execFileSync('pnpm', ['-s', 'build'], { stdio: 'ignore' });
  server = await serve({ '': path.resolve('dist') });
  browser = await launchChrome();
  context = await browser.newContext({ acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(server.url);
});

after(async () => {
  await context?.close();
  await browser?.close();
  await server?.close();
});

test('default example renders and its exported GLB matches the CLI build', async () => {
  const cli = (await buildFile('examples/torch.js')).stats;
  await statsReady(String(cli.triangles));
  assert.equal(await stat('meshes').textContent(), String(cli.meshes));
  assert.equal(await stat('drawCalls').textContent(), '3');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  assert.equal(download.suggestedFilename(), 'torch.glb');
  const glb = await readFile(/** @type {string} */ (await download.path()));
  assert.equal((await validator.validateBytes(new Uint8Array(glb))).issues.numErrors, 0);
  const web = await inspectGLB(glb);
  assert.equal(web.triangles, cli.triangles);
  assert.equal(web.instances, cli.instances);
  [...cli.min, ...cli.max].forEach((v, i) => assert.ok(Math.abs(v - [...web.min, ...web.max][i]) <= 1e-4, `bbox[${i}]`));
});

test('importing a GLB puts equivalent code in the editor', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'meshcode-'));
  const file = path.join(dir, 'crates.glb');
  await writeFile(file, (await buildFile('examples/crates.js')).glb);
  await page.setInputFiles('#import', file);
  await statsReady('72');
  assert.match(await code(), /new THREE\.InstancedMesh\(g0, mat0, 6\)/);
  assert.match(await page.locator('#status').textContent() ?? '', /imported: box ×1, instancedMesh ×1/);
});

test('share link restores the exact code in a fresh page', async () => {
  const original = await code();
  await page.click('#share');
  await page.waitForFunction(() => location.hash.startsWith('#code='));
  const other = await context.newPage();
  await other.goto(page.url());
  await other.waitForFunction(() => document.querySelector('[data-stat="triangles"]')?.textContent === '72', null, { timeout: 20000 });
  assert.equal(await other.evaluate(() => globalThis.meshcodeEditor.state.doc.toString()), original);
  await other.close();
});

test('user code is sandboxed: it cannot reach the app page', async () => {
  assert.deepEqual(pageErrors, [], 'no errors before the attack');
  await page.evaluate(() => {
    const ed = globalThis.meshcodeEditor;
    ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert:
      "export default (T) => { parent.document.title = 'pwned'; return new T.Group(); };" } });
  });
  await page.click('#run');
  await page.locator('#error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#error').textContent() ?? '', /cross-origin|Blocked a frame/i);
  assert.equal(await page.title(), 'meshcode');
});

test('PWA: valid manifest and works offline after the first visit', async () => {
  const ctx = await browser.newContext();
  try {
    const p = await ctx.newPage();
    const loaded = () => p.waitForFunction(() => document.querySelector('[data-stat="triangles"]')?.textContent === '60', null, { timeout: 20000 });
    await p.goto(server.url);
    await loaded();
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); // now under service-worker control: every asset gets cached
    await loaded();
    const cdp = await ctx.newCDPSession(p);
    assert.deepEqual((await cdp.send('Page.getAppManifest')).errors, []);
    await ctx.setOffline(true);
    await p.reload();
    await loaded();
  } finally {
    await ctx.close();
  }
});
