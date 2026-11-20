// GLB → code must rebuild the same model; primitives must come back as constructor calls.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildFile, decompileFile, verifyFiles, withPage } from '../src/browser.mjs';
import { meshoptGLB } from '../src/optimize.mjs';

const tmp = () => mkdtemp(path.join(tmpdir(), 'meshcode-'));

/** build model.js → .glb in dir, return its path */
async function glbOf(/** @type {string} */ model, /** @type {string} */ dir, /** @type {string} */ name) {
  const file = path.join(dir, `${name}.glb`);
  await writeFile(file, (await buildFile(model)).glb);
  return file;
}

/** @param {Awaited<ReturnType<typeof decompileFile>>} r */
function assertFaithful(r, minIoU = 0.999) {
  assert.ok(r.fidelity.min >= minIoU, `IoU min ${r.fidelity.min} < ${minIoU}`);
  for (const k of /** @type {const} */ (['meshes', 'instances', 'triangles'])) assert.equal(r.fidelity.b[k], r.fidelity.a[k], k);
  assert.deepEqual(r.fidelity.materials, [], 'materials must match');
}

test('torch: primitives detected, exact rebuild, stable on a second round trip, texture pixels kept', async () => {
  const dir = await tmp();
  const glb = await glbOf('test/fixtures/primitives.js', dir, 'torch');
  const first = await decompileFile(glb, path.join(dir, 'torch1.js'));
  assert.deepEqual(first.summary, { box: 1, cylinder: 1, cone: 1 });
  assert.match(first.code, /new THREE\.CylinderGeometry\(0\.05, 0\.035, 0\.8, 8\)/);
  assert.doesNotMatch(first.code, /const data = /, 'no raw vertex data for primitives');
  assertFaithful(first);

  // decompile(build(decompile(x))) === decompile(x): no extra nesting, no drift.
  const glb2 = await glbOf(path.join(dir, 'torch1.js'), dir, 'torch2');
  const second = await decompileFile(glb2, path.join(dir, 'torch1.js'));
  const strip = (/** @type {string} */ c) => c.split('\n').slice(1).join('\n');
  assert.equal(strip(second.code), strip(first.code));

  // Texture survives GLB → PNG → GLB with identical pixels (catches flips and colour shifts).
  const [a, b] = await Promise.all([readFile(glb), readFile(glb2)]);
  const same = await withPage({}, (page) => page.evaluate(async ([ga, gb]) => {
    const core = await import('/meshcode/core/glb.js');
    const pixels = async (/** @type {string} */ b64) => {
      let img;
      (await core.loadGLB(globalThis.__fromB64(b64))).traverse((o) => { img ??= o.material?.map?.image; });
      const c = new OffscreenCanvas(img.width, img.height), ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, img.width, img.height).data);
    };
    const [pa, pb] = await Promise.all([pixels(ga), pixels(gb)]);
    return pa.length > 0 && pa.every((v, i) => v === pb[i]);
  }, [a.toString('base64'), b.toString('base64')]));
  assert.ok(same, 'texture pixels differ after round trip');
});

test('crates: InstancedMesh comes back with every instance', async () => {
  const dir = await tmp();
  const r = await decompileFile(await glbOf('test/fixtures/instanced.js', dir, 'crates'), path.join(dir, 'crates.js'));
  assert.deepEqual(r.summary, { box: 1, instancedMesh: 1 });
  assertFaithful(r);
});

test('non-primitive geometry falls back to exact vertex data', async () => {
  const dir = await tmp();
  const model = path.join(dir, 'knot.js');
  await writeFile(model, `export default (THREE) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.15, 48, 8), new THREE.MeshStandardMaterial()));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(2, 0, 0), new THREE.MeshStandardMaterial()));
    return g;
  };`);
  const r = await decompileFile(await glbOf(model, dir, 'knot'), path.join(dir, 'knot.out.js'));
  assert.equal(r.summary.data, 2, 'torus knot and off-centre box are not primitives');
  assertFaithful(r);
});

test('meshopt (quantized) GLB decompiles faithfully', async () => {
  const dir = await tmp();
  const raw = await buildFile('test/fixtures/primitives.js');
  const glb = path.join(dir, 'torch.meshopt.glb');
  await writeFile(glb, await meshoptGLB(raw.glb));
  assertFaithful(await decompileFile(glb, path.join(dir, 'torch.js')), 0.99);
});

test('silhouette IoU tells different shapes apart', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'box.js'), 'export default (T) => new T.Mesh(new T.BoxGeometry(1, 1, 1));');
  await writeFile(path.join(dir, 'ball.js'), 'export default (T) => new T.Mesh(new T.SphereGeometry(0.5, 32, 16));');
  const same = await verifyFiles(path.join(dir, 'box.js'), path.join(dir, 'box.js'));
  const diff = await verifyFiles(path.join(dir, 'box.js'), path.join(dir, 'ball.js'));
  assert.equal(same.mean, 1);
  assert.ok(diff.mean < 0.95, `box vs sphere IoU ${diff.mean} should be clearly < 1`);
});

test('normal map without tangents keeps the flipped normalScale (relief not inverted)', async () => {
  const dir = await tmp();
  const model = path.join(dir, 'bumpy.js');
  await writeFile(model, `export default (THREE) => {
    const c = document.createElement('canvas'); c.width = c.height = 4;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, 4, 4);
    return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ normalMap: new THREE.CanvasTexture(c) }));
  };`);
  const glb = await glbOf(model, dir, 'bumpy');
  const r = await decompileFile(glb, path.join(dir, 'bumpy.out.js'));
  assert.match(r.code, /normalScale: new THREE\.Vector2\(1, -1\)/);
  assert.deepEqual(r.fidelity.materials, []);

  // Negative control: the material check must notice when normalScale is lost.
  const broken = path.join(dir, 'bumpy.broken.js');
  const stripped = r.code.replace(/normalScale: new THREE\.Vector2\(1, -1\),?\s*/, '');
  assert.notEqual(stripped, r.code, 'control must actually remove normalScale');
  await writeFile(broken, stripped);
  const v = await verifyFiles(glb, broken);
  assert.equal(v.mean, 1, 'shape is identical');
  assert.ok(v.materials.some((d) => d.includes('normalScale')), `expected a normalScale diff, got ${JSON.stringify(v.materials)}`);
});

// Every shipped example must decompile back to the same shape AND look (materials, texture
// transforms, instance colours, lights). This is what users get from Import GLB.
for (const file of readdirSync('examples').filter((f) => f.endsWith('.js'))) {
  test(`examples/${file}: decompile is faithful`, async () => {
    const dir = await tmp();
    const name = file.replace(/\.js$/, '');
    const r = await decompileFile(await glbOf(`examples/${file}`, dir, name), path.join(dir, `${name}.out.js`));
    assertFaithful(r);
    assert.deepEqual(r.warnings, []);
  });
}
