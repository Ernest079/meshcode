// Measurements of an original model used to write its code imitation: per palette colour (sampled from the atlas
// at each triangle's UV centroid) the triangle count, extent and face normals; 'profile' adds the (y | radius) rings.
//   node bench/real/measure.mjs <model.gltf|.glb> [profile]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = path.join(os.tmpdir(), 'mc-measure.png');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const tex = doc.getRoot().listTextures()[0];
const [W, H] = tex.getSize();
writeFileSync(TMP, tex.getImage());
const px = execFileSync('convert', [TMP, '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 28 });
const hex = (u, v) => { const x = Math.min(W - 1, Math.floor(((u % 1) + 1) % 1 * W)), y = Math.min(H - 1, Math.floor(((v % 1) + 1) % 1 * H)); const i = (y * W + x) * 4; return '#' + [0, 1, 2].map((c) => px[i + c].toString(16).padStart(2, '0')).join(''); };
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  console.log(`\n## ${node.getName()} T=${node.getTranslation().map((v) => +v.toFixed(4))} R=${node.getRotation().map((v) => +v.toFixed(3))} S=${node.getScale().map((v) => +v.toFixed(3))}`);
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), U = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
    const idx = I ? Array.from(I.getArray()) : [...Array(P.getCount()).keys()];
    const colors = new Map();
    for (let f = 0; f < idx.length; f += 3) {
      const tri = [0, 1, 2].map((k) => idx[f + k]);
      const p = tri.map((i) => P.getElement(i, [])), uv = tri.map((i) => U.getElement(i, []));
      const c = hex((uv[0][0] + uv[1][0] + uv[2][0]) / 3, (uv[0][1] + uv[1][1] + uv[2][1]) / 3);
      const n = (() => { const a = p[1].map((v, i) => v - p[0][i]), b = p[2].map((v, i) => v - p[0][i]); const x = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; const l = Math.hypot(...x) || 1; return x.map((v) => v / l); })();
      const e = colors.get(c) ?? { tris: 0, min: [9, 9, 9], max: [-9, -9, -9], normals: new Set() };
      e.tris++; for (const q of p) for (let i = 0; i < 3; i++) { e.min[i] = Math.min(e.min[i], q[i]); e.max[i] = Math.max(e.max[i], q[i]); }
      e.normals.add(n.map((v) => Math.round(v * 2) / 2).join(','));
      colors.set(c, e);
    }
    for (const [c, e] of colors) console.log(`  ${c} ${String(e.tris).padStart(3)} tris  [${e.min.map((v) => +v.toFixed(3))}]→[${e.max.map((v) => +v.toFixed(3))}]  n:${[...e.normals].slice(0, 6).join(' ')}`);
    if (process.argv[3] === 'profile') {
      const rings = new Map();
      for (let i = 0; i < P.getCount(); i++) { const [x, y, z] = P.getElement(i, []); const k = `${y.toFixed(3)}|${Math.hypot(x, z).toFixed(3)}`; rings.set(k, (rings.get(k) ?? 0) + 1); }
      console.log('  (y | r): ' + [...rings.keys()].sort((a, b) => parseFloat(a) - parseFloat(b)).join('  '));
    }
  }
}
