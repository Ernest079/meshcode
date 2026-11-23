// Engine export. Godot: the generated GDScript is RUN in headless Godot (when installed) and every
// mesh's world AABB, triangles and instances must match three.js. Unity (no Unity here): the C# is
// checked structurally, and its embedded mesh data must face the right way after the Z mirror.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exportEngineFile } from '../src/browser.mjs';

const GODOT = process.env.MESHCODE_GODOT ?? 'godot';
const hasGodot = spawnSync(GODOT, ['--version'], { encoding: 'utf8' }).status === 0;
const MODELS = [
  ...readdirSync('examples').filter((f) => f.endsWith('.js')).map((f) => `examples/${f}`),
  'test/fixtures/primitives.js',
  'test/fixtures/instanced.js',
];

/** Run validate.gd on a generated script and parse its JSON line. @param {string} gd */
function godotMeshes(gd) {
  const out = execFileSync(GODOT, ['--headless', '--script', path.resolve('test/godot/validate.gd'), '--', gd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const line = out.split('\n').find((l) => l.startsWith('MESHCODE_JSON '));
  assert.ok(line, `no result from Godot:\n${out}`);
  return JSON.parse(line.slice('MESHCODE_JSON '.length));
}

for (const model of MODELS) {
  test(`${model} → Godot: same meshes, instances and world AABBs when run in Godot`, { skip: !hasGodot && 'godot not installed' }, async () => {
    const r = await exportEngineFile(model, 'godot');
    const gd = path.join(await mkdtemp(path.join(tmpdir(), 'meshcode-')), r.filename);
    await writeFile(gd, r.code);
    const got = godotMeshes(gd);
    assert.equal(got.length, r.boxes.length, 'mesh count');
    r.boxes.forEach((want, i) => {
      const have = got[i], at = `${model} mesh ${i} (${want.name})`;
      assert.ok(!want.name || have.name.startsWith(want.name), `${at}: name ${have.name}`); // Godot suffixes duplicates: corner, corner2…
      assert.equal(have.instances, r.meshes[i].instances, `${at}: instances`);
      const tol = 1e-3 * Math.max(1, ...want.max.map((v, k) => v - want.min[k]));
      [...want.min, ...want.max].forEach((v, k) => assert.ok(Math.abs(v - [...have.min, ...have.max][k]) <= tol, `${at}: aabb[${k}] ${v} vs ${[...have.min, ...have.max][k]}`));
      // Vertex-data meshes are exact; Godot primitives may add degenerate pole/apex triangles.
      if (r.meshes[i].kind === 'data') assert.equal(have.triangles, want.triangles, `${at}: triangles`);
      else assert.ok(have.triangles >= want.triangles, `${at}: primitive has fewer triangles`);
    });
    // Animations only travel in the GLB: the script says so instead of dropping them silently.
    assert.deepEqual(r.warnings, model === 'examples/chest.js' ? ['1 animation(s) not included here: export GLB, which Godot and Unity import with its animations'] : []);
  });
}

/** Decode `const string X = "base64"` (C#) or `"X": "base64"` (GDScript) blocks. @param {string} code @param {string} key */
const blob = (code, key) => {
  const m = code.match(new RegExp(`${key}"?\\s*[=:]\\s*"([A-Za-z0-9+/=]+)"`));
  assert.ok(m, `missing ${key}`);
  return Buffer.from(m[1], 'base64');
};
/** Fraction of triangles whose winding cross product agrees with the stored vertex normals. */
function facing(/** @type {Buffer} */ p, /** @type {Buffer} */ n, /** @type {Buffer} */ i) {
  const P = new Float32Array(p.buffer, p.byteOffset, p.length / 4), N = new Float32Array(n.buffer, n.byteOffset, n.length / 4);
  const I = new Int32Array(i.buffer, i.byteOffset, i.length / 4);
  let agree = 0, total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (Math.hypot(...cross) < 1e-12) continue; // degenerate
    const k = I[t];
    agree += cross[0] * N[k * 3] + cross[1] * N[k * 3 + 1] + cross[2] * N[k * 3 + 2] > 0 ? 1 : 0;
    total++;
  }
  return agree / total;
}

test('winding: Unity data faces front after the Z mirror; Godot data is clockwise', async () => {
  const unity = await exportEngineFile('examples/barrel.js', 'unity');
  const id = unity.code.match(/const string (mesh\d+)_p/)?.[1];
  assert.ok(id);
  // Unity (left-handed, clockwise front): cross(b−a, c−a) must point along the normal.
  assert.ok(facing(blob(unity.code, `${id}_p`), blob(unity.code, `${id}_n`), blob(unity.code, `${id}_i`)) > 0.99);
  const godot = await exportEngineFile('examples/barrel.js', 'godot');
  const key = godot.code.match(/"(mesh\d+)": \{ "p"/)?.[1];
  assert.ok(key);
  const g = godot.code.slice(godot.code.indexOf(`"${key}": {`));
  // Godot (right-handed, clockwise front): cross(b−a, c−a) points AGAINST the normal.
  assert.ok(facing(blob(g, '"p'), blob(g, '"n'), blob(g, '"i')) < 0.01);
});

test('Unity C#: class named after the model, balanced braces, no unexported textures warnings for examples without maps', async () => {
  const r = await exportEngineFile('examples/spaceship.js', 'unity');
  assert.equal(r.filename, 'SpaceshipModel.cs');
  assert.match(r.code, /public class SpaceshipModel : MonoBehaviour/);
  const code = r.code.replace(/"[^"]*"/g, '""'); // strings (base64, names) out of the way
  assert.equal((code.match(/\{/g) ?? []).length, (code.match(/\}/g) ?? []).length);
  assert.deepEqual(r.warnings, []);
});
