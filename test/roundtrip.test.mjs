// code → GLB → load must preserve meshes, instances, triangles and bounding box.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import validator from 'gltf-validator';
import { buildFile, inspectGLB, withPage } from '../src/browser.mjs';
import { meshoptGLB } from '../src/optimize.mjs';

const EXAMPLES = ['torch', 'crates'];

/** Khronos reference validator: the GLB must have zero spec errors. @param {Uint8Array} glb */
async function assertValid(glb) {
  const report = await validator.validateBytes(new Uint8Array(glb));
  const errors = report.issues.messages.filter((m) => m.severity === 0);
  assert.equal(report.issues.numErrors, 0, JSON.stringify(errors, null, 1));
}

/** @param {import('../src/browser.mjs').Stats} a @param {import('../src/browser.mjs').Stats} b @param {number} tol */
function assertSameModel(a, b, tol) {
  assert.equal(b.meshes, a.meshes, 'meshes');
  assert.equal(b.instances, a.instances, 'instances');
  assert.equal(b.triangles, a.triangles, 'triangles');
  [...a.min, ...a.max].forEach((v, i) => {
    const w = [...b.min, ...b.max][i];
    assert.ok(Math.abs(v - w) <= tol, `bbox[${i}] ${v} vs ${w} (tol ${tol})`);
  });
}

for (const name of EXAMPLES) {
  test(`${name}: code → GLB → load roundtrip (raw and meshopt)`, async () => {
    const { glb, stats } = await buildFile(`examples/${name}.js`);
    assert.ok(stats.triangles > 0, 'model has geometry');
    await assertValid(glb);
    assertSameModel(stats, await inspectGLB(glb), 1e-4);

    // meshopt quantizes positions: allow 0.1% of the bbox diagonal.
    const diag = Math.hypot(...stats.max.map((v, i) => v - stats.min[i]));
    const packed = await meshoptGLB(glb);
    await assertValid(packed);
    assertSameModel(stats, await inspectGLB(packed), 1e-3 * diag);
  });
}

test('a model that does not return an Object3D fails with a clear error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'meshcode-'));
  const file = path.join(dir, 'bad.js');
  await writeFile(file, 'export default () => 42;');
  await assert.rejects(buildFile(file), /must return a THREE\.Object3D/);
});

test('page cannot read files outside the served roots', async () => {
  const codes = await withPage({}, (page) => page.evaluate(async () =>
    Promise.all(['/meshcode/core/glb.js', '/meshcode/%2e%2e%2fpackage.json', '/nope/x.js', '/constructor/x']
      .map((u) => fetch(u).then((r) => r.status)))));
  assert.deepEqual(codes, [200, 404, 404, 404]);
});
