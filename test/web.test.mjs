// End-to-end: the built web app in headless Chrome (WebGL via SwiftShader).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import validator from 'gltf-validator';
import { buildFile, inspectGLB, launchChrome, serve } from '../src/browser.mjs';
import { fakeLLM } from './fake-llm.mjs';

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
  await statsReady(cli.triangles.toLocaleString('en'));
  assert.equal(await stat('meshes').textContent(), String(cli.meshes));
  assert.equal(await stat('drawCalls').textContent(), String(cli.meshes), 'one draw call per mesh (instancing included)');

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
  await writeFile(file, (await buildFile('test/fixtures/instanced.js')).glb);
  await page.setInputFiles('#import', file);
  await statsReady('72');
  assert.match(await code(), /new THREE\.InstancedMesh\(g0, mat0, 6\)/);
  assert.match(await page.locator('#status').textContent() ?? '', /imported: box ×1, instancedMesh ×1/);
});

test('share link restores the exact code in a fresh page', async () => {
  const original = await code();
  await page.click('#share');
  await page.waitForFunction(() => location.hash.startsWith('#mode=3d&code='));
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
    const loaded = () => p.waitForFunction(() => !['–', undefined].includes(document.querySelector('[data-stat="triangles"]')?.textContent), null, { timeout: 20000 });
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

test('theme picker applies and remembers light/dark', async () => {
  const p = await context.newPage();
  await p.goto(server.url);
  const isDark = () => p.evaluate(() => document.documentElement.classList.contains('dark'));
  await p.selectOption('#theme', 'dark');
  assert.equal(await isDark(), true);
  await p.reload();
  assert.equal(await isDark(), true, 'remembered across reloads, applied before first paint');
  await p.selectOption('#theme', 'light');
  assert.equal(await isDark(), false);
  await p.selectOption('#theme', 'system');
  await p.close();
});

test('2D mode: example renders, exports PNG at sheet size, SVG source exports as-is', async () => {
  const p = await context.newPage();
  await p.goto(server.url);
  await p.selectOption('#examples', 'walk');
  await p.waitForFunction(() => document.querySelector('[data-stat="frames"]')?.textContent === '8 → sheet 512×64', null, { timeout: 20000 });
  assert.equal(await p.getAttribute('#mode-2d', 'aria-pressed'), 'true');
  await p.selectOption('#format', 'png');
  const [png] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
  assert.equal(png.suggestedFilename(), 'spritesheet.png');
  const bytes = await readFile(/** @type {string} */ (await png.path()));
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [512, 64]);

  await p.selectOption('#examples', 'icons');
  await p.waitForFunction(() => document.querySelector('[data-stat="kind"]')?.textContent === 'svg', null, { timeout: 20000 });
  await p.selectOption('#format', 'svg');
  const [svg] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
  const source = await p.evaluate(() => globalThis.meshcodeEditor.state.doc.toString());
  assert.equal(await readFile(/** @type {string} */ (await svg.path()), 'utf8'), source);

  // Share link keeps the mode.
  await p.click('#share');
  await p.waitForFunction(() => location.hash.startsWith('#mode=2d&code='));
  await p.close();
});

test('3D export to Godot and Unity downloads engine source', async () => {
  const p = await context.newPage();
  await p.goto(server.url);
  await p.selectOption('#examples', 'spaceship');
  await p.waitForFunction(() => document.querySelector('[data-stat="meshes"]')?.textContent === '21', null, { timeout: 20000 });
  for (const [format, file, marker] of [['godot', 'spaceship.gd', 'extends Node3D'], ['unity', 'SpaceshipModel.cs', 'public class SpaceshipModel : MonoBehaviour']]) {
    await p.selectOption('#format', format);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
    assert.equal(dl.suggestedFilename(), file);
    assert.ok((await readFile(/** @type {string} */ (await dl.path()), 'utf8')).includes(marker));
  }
  await p.close();
});

test('AI panel: generate (with a repair), reject, edit with a diff, accept; the key stays in the tab', async () => {
  const fake = await fakeLLM();
  const p = await context.newPage();
  try {
    const fence = (/** @type {string} */ c) => `Sure:\n\`\`\`js\n${c}\`\`\``;
    const BOX = 'export default (THREE) => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());\n';
    const TALL = BOX.replace('BoxGeometry()', 'BoxGeometry(1, 3, 1)');
    const editorCode = () => p.evaluate(() => globalThis.meshcodeEditor.state.doc.toString());
    await p.goto(server.url);
    await p.selectOption('#examples', 'torch'); // earlier tests left other drafts in this context
    await p.waitForFunction(() => document.querySelector('[data-stat="meshes"]')?.textContent !== '–', null, { timeout: 20000 });
    const torch = await editorCode();

    await p.click('#ai-toggle');
    await p.click('#ai-settings-open');
    await p.fill('#ai-base-url', `${fake.url}/v1`);
    await p.fill('#ai-key', 'sk-local-test');
    await p.dispatchEvent('#ai-key', 'change');
    await p.click('#ai-load-models');
    await p.waitForFunction(() => document.querySelector('#ai-settings-status')?.textContent?.startsWith('1 model:'));
    assert.equal(await p.inputValue('#ai-model'), 'fake-coder', 'first listed model picked');
    await p.click('#ai-settings button[value="done"]');
    assert.deepEqual(await p.evaluate(() => [localStorage.getItem('meshcode:ai-key'), sessionStorage.getItem('meshcode:ai-key')]), [null, 'sk-local-test']);

    fake.replies.push(fence("export default () => { throw new Error('first try'); };\n"), fence(BOX));
    await p.fill('#ai-prompt', 'a box');
    await p.press('#ai-prompt', 'Enter');
    await p.locator('#ai-review').waitFor({ state: 'visible', timeout: 20000 });
    await p.waitForFunction(() => /done in 2 replies/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 20000 });
    assert.equal(await editorCode(), BOX);
    await p.waitForFunction(() => document.querySelector('[data-stat="triangles"]')?.textContent === '12', null, { timeout: 20000 });
    const chat = fake.requests.filter((r) => r.path.endsWith('/chat/completions'));
    assert.equal(chat[0].headers.authorization, 'Bearer sk-local-test');
    assert.match(chat[1].body.messages.at(-1).content, /Error: first try/);

    await p.click('#ai-reject');
    assert.equal(await editorCode(), torch, 'reject restores the code from before');
    assert.equal(await p.locator('#ai-review').isHidden(), true);

    fake.replies.push(fence(TALL));
    await p.fill('#ai-prompt', 'make it tall');
    await p.click('#ai-edit');
    await p.locator('#ai-review').waitFor({ state: 'visible', timeout: 20000 });
    assert.match(fake.requests.at(-1)?.body.messages[1].content, /Current code:[\s\S]*wall torch/i, 'edit sends the current code');
    assert.ok(await p.locator('.cm-deletedChunk').count() > 0, 'edits show a diff against the previous code');
    await p.click('#ai-accept');
    assert.equal(await editorCode(), TALL);
    assert.equal(await p.locator('.cm-deletedChunk').count(), 0, 'diff closed after accept');
  } finally {
    await p.close();
    await fake.close();
  }
});

test('pick ↔ code: clicking a mesh selects its block; the cursor block is outlined; edits since the run are mapped', async () => {
  const p = await context.newPage();
  const MODEL = `const part = (T, name, x) => {
  const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial());
  m.name = name;
  m.position.x = x;
  return m;
};
export default (T) => {
  const g = new T.Group();
  g.add(part(T, 'left', -1.5));
  g.add(part(T, 'right', 1.5));
  const solo = new T.Mesh(new T.SphereGeometry(0.4), new T.MeshStandardMaterial());
  solo.name = 'solo';
  solo.position.set(0, 0, 1.2);
  g.add(solo);
  return g;
};
`;
  try {
    await p.goto(server.url);
    await p.evaluate((code) => {
      const ed = globalThis.meshcodeEditor;
      ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: code } });
    }, MODEL);
    await p.click('#run');
    await p.waitForFunction(() => document.querySelector('[data-stat="meshes"]')?.textContent === '3', null, { timeout: 20000 });
    const viewer = /** @type {import('playwright-core').Frame} */ (p.frames().find((f) => f !== p.mainFrame()));
    const box = /** @type {{ x: number, y: number }} */ (await p.locator('#viewer').boundingBox());
    /** Click the screen position of a named object's centre, as a user would. @param {string} name */
    const clickOn = async (name) => {
      const [x, y] = await viewer.evaluate((n) => {
        const v = globalThis.meshcodeViewer, o = v.current().getObjectByName(n);
        const c = o.getWorldPosition(o.position.clone()).project(v.camera);
        return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
      }, name);
      await p.evaluate(() => { document.querySelector('#status').textContent = ''; });
      await p.mouse.click(box.x + x, box.y + y);
      await p.waitForFunction((n) => document.querySelector('#status')?.textContent?.startsWith(`${n} → line`), name); // the reply is async
    };
    const selected = () => p.evaluate(() => { const s = globalThis.meshcodeEditor.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); });
    const outlined = () => viewer.evaluate(() => globalThis.meshcodeViewer.highlighted());

    await clickOn('right');
    assert.equal(await selected(), "g.add(part(T, 'right', 1.5));", 'the call that makes this part, not the shared helper line');
    assert.deepEqual(await outlined(), ['right']);
    assert.match(await p.locator('#status').textContent() ?? '', /right → line 10/);

    await clickOn('solo');
    assert.equal(await selected(), "const solo = new T.Mesh(new T.SphereGeometry(0.4), new T.MeshStandardMaterial());\n  solo.name = 'solo';\n  solo.position.set(0, 0, 1.2);");

    // Cursor → viewer: a configuring line outlines its object; the helper's line outlines every part it made.
    const cursorAt = (/** @type {string} */ text) => p.evaluate((t) => {
      const ed = globalThis.meshcodeEditor;
      ed.dispatch({ selection: { anchor: ed.state.doc.toString().indexOf(t) }, userEvent: 'select' });
    }, text);
    await cursorAt("solo.position.set");
    await viewer.waitForFunction(() => globalThis.meshcodeViewer.highlighted().join() === 'solo');
    await cursorAt('new T.BoxGeometry');
    await viewer.waitForFunction(() => globalThis.meshcodeViewer.highlighted().join() === 'left,right');

    // Edits since the last good run (this one does not compile) are mapped: picking still lands right.
    await p.evaluate(() => globalThis.meshcodeEditor.dispatch({ changes: { from: 0, insert: '@@ not code\n\n' } }));
    await p.locator('#error').waitFor({ state: 'visible', timeout: 20000 });
    await clickOn('left');
    assert.equal(await selected(), "g.add(part(T, 'left', -1.5));");
  } finally {
    await p.close();
  }
});
