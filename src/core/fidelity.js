// @ts-check
// Silhouette IoU between two Object3Ds: orthographic CPU rasterization from 6 directions.
// CPU on purpose: deterministic on every machine (headless Chrome's WebGL is SwiftShader anyway).
import * as THREE from 'three';
import { MAP_SLOTS, MATERIAL_COLORS, MATERIAL_SCALARS, MATERIAL_VECTORS } from './decompile.js';

const VIEWS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 1, 1], [1, 1, -1]]
  .map((v) => new THREE.Vector3(...v).normalize());

/**
 * World-space triangle soup (9 floats per triangle), instances included.
 * @param {THREE.Object3D} root
 */
export function worldTriangles(root) {
  root.updateMatrixWorld(true);
  /** @type {number[]} */
  const out = [];
  const v = new THREE.Vector3(), inst = new THREE.Matrix4(), m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position, index = o.geometry.index;
    const count = index ? index.count : pos.count;
    const n = o instanceof THREE.InstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k++) {
      if (o instanceof THREE.InstancedMesh) m.multiplyMatrices(o.matrixWorld, o.getMatrixAt(k, inst));
      else m.copy(o.matrixWorld);
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m); // getX dequantizes normalized data
        out.push(v.x, v.y, v.z);
      }
    }
  });
  return new Float32Array(out);
}

/**
 * Fill triangles into a size×size mask (pixel-centre sampling, either winding).
 * @param {Float32Array} tris @param {THREE.Vector3} dir @param {THREE.Vector3} center @param {number} radius @param {number} size
 */
function rasterize(tris, dir, center, radius, size) {
  const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, dir).normalize();
  const w = new THREE.Vector3().crossVectors(dir, u);
  const mask = new Uint8Array(size * size);
  const k = size / (2 * radius);
  const px = new Float32Array(6);
  for (let t = 0; t < tris.length; t += 9) {
    for (let j = 0; j < 3; j++) {
      const x = tris[t + j * 3] - center.x, y = tris[t + j * 3 + 1] - center.y, z = tris[t + j * 3 + 2] - center.z;
      px[j * 2] = (x * u.x + y * u.y + z * u.z) * k + size / 2;
      px[j * 2 + 1] = (x * w.x + y * w.y + z * w.z) * k + size / 2;
    }
    const [ax, ay, bx, by, cx, cy] = px;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const s = Math.sign(area);
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const pxc = x + 0.5;
        const e0 = ((bx - ax) * (py - ay) - (by - ay) * (pxc - ax)) * s;
        const e1 = ((cx - bx) * (py - by) - (cy - by) * (pxc - bx)) * s;
        const e2 = ((ax - cx) * (py - cy) - (ay - cy) * (pxc - cx)) * s;
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) mask[y * size + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Intersection-over-union of the two silhouettes, per view, framed on the union bounding box.
 * 1 = indistinguishable outline from every view; ignores colour, texture and hidden interior.
 * @param {THREE.Object3D} a @param {THREE.Object3D} b @param {number} [size]
 * @returns {{ mean: number, min: number, views: number[] }}
 */
export function silhouetteIoU(a, b, size = 256) {
  const ta = worldTriangles(a), tb = worldTriangles(b);
  const box = new THREE.Box3();
  for (const t of [ta, tb]) for (let i = 0; i < t.length; i += 3) box.expandByPoint(new THREE.Vector3(t[i], t[i + 1], t[i + 2]));
  if (box.isEmpty()) return { mean: 1, min: 1, views: VIEWS.map(() => 1) };
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-9) * 1.02;
  const views = VIEWS.map((dir) => {
    const ma = rasterize(ta, dir, center, radius, size), mb = rasterize(tb, dir, center, radius, size);
    let inter = 0, union = 0;
    for (let i = 0; i < ma.length; i++) {
      inter += ma[i] & mb[i];
      union += ma[i] | mb[i];
    }
    return union ? inter / union : 1;
  });
  return { mean: views.reduce((s, v) => s + v, 0) / views.length, min: Math.min(...views), views };
}

/**
 * Material differences between two models, mesh by mesh in traversal order.
 * Complements silhouette IoU, which is blind to shading. Textures compare by presence only.
 * @param {THREE.Object3D} a @param {THREE.Object3D} b
 * @returns {string[]} human-readable differences; empty means equivalent
 */
export function materialDiff(a, b) {
  /** @param {THREE.Object3D} root */
  const meshes = (root) => {
    /** @type {any[]} */ const out = [];
    root.traverse((o) => { if (o instanceof THREE.Mesh) out.push(o); });
    return out;
  };
  const meshA = meshes(a), meshB = meshes(b);
  const ma = meshA.map((o) => [o.material].flat()[0]), mb = meshB.map((o) => [o.material].flat()[0]);
  if (ma.length !== mb.length) return [`mesh count ${ma.length} vs ${mb.length}`];
  /** @type {string[]} */ const diffs = [];
  const close = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(x - y) <= 1e-4 * Math.max(1, Math.abs(x));
  ma.forEach((x, i) => {
    const at = `mesh ${i}`;
    if (x.type !== mb[i].type) return diffs.push(`${at}: type ${x.type} vs ${mb[i].type}`);
    const y = mb[i];
    for (const k of MATERIAL_COLORS) if (x[k]?.isColor && x[k].getHex() !== y[k].getHex()) diffs.push(`${at}: ${k} ${x[k].getHexString()} vs ${y[k].getHexString()}`);
    for (const k of MATERIAL_SCALARS) {
      if (!(k in x)) continue;
      const same = typeof x[k] === 'number' ? close(x[k], y[k]) : x[k] === y[k];
      if (!same) diffs.push(`${at}: ${k} ${x[k]} vs ${y[k]}`);
    }
    for (const k of MATERIAL_VECTORS) if (x[k]?.isVector2 && !(close(x[k].x, y[k].x) && close(x[k].y, y[k].y))) diffs.push(`${at}: ${k} ${x[k].toArray()} vs ${y[k].toArray()}`);
    for (const k of MAP_SLOTS) {
      if (!!x[k] !== !!y[k]) diffs.push(`${at}: ${k} ${x[k] ? 'present' : 'missing'} vs ${y[k] ? 'present' : 'missing'}`);
      else if (x[k]) for (const t of ['repeat', 'offset', 'center']) {
        if (!(close(x[k][t].x, y[k][t].x) && close(x[k][t].y, y[k][t].y))) diffs.push(`${at}: ${k}.${t} ${x[k][t].toArray()} vs ${y[k][t].toArray()}`);
      }
    }
    // Per-instance colours are part of the look of an InstancedMesh.
    const ca = meshA[i].instanceColor, cb = meshB[i].instanceColor;
    if (!!ca !== !!cb) diffs.push(`${at}: instance colours ${ca ? 'present' : 'missing'} vs ${cb ? 'present' : 'missing'}`);
    else if (ca && ca.array.some((/** @type {number} */ v, /** @type {number} */ j) => Math.abs(v - cb.array[j]) > 2 / 255)) diffs.push(`${at}: instance colours differ`);
  });
  return diffs;
}
