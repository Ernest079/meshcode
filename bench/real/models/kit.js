// @ts-check
// Shared helpers for the code imitations of the real (CC0) assets. Low-poly palette art is mostly stacks of
// horizontal rings (lathes, rounded boxes), faceted, one colour per face: that is all this kit builds.
// Colours are the originals' palette, measured with bench/real/measure.mjs.

/** @typedef {[number, number, number]} V3 */

/** Linear gradient through sRGB hex stops [[t, hex], …] (t ascending). @param {[number, number][]} stops */
export const gradient = (stops) => (/** @type {number} */ t) => {
  const i = Math.max(0, stops.findIndex(([s]) => s >= t) - 1), [t0, a] = stops[i], [t1, b] = stops[Math.min(i + 1, stops.length - 1)];
  const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return [16, 8, 0].reduce((hex, sh) => hex | (Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k) << sh), 0);
};

/** Rounded rectangle in the xz plane: core half sizes (hx, hz), corner radius r, `segs` steps per corner. */
export function roundedRect(/** @type {number} */ hx, /** @type {number} */ hz, /** @type {number} */ r, segs = 1) {
  /** @type {[number, number][]} */ const pts = [];
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    for (let k = 0; k <= segs; k++) {
      const a = ((a0 + (90 * k) / segs) * Math.PI) / 180;
      pts.push([sx * hx + r * Math.cos(a), sz * hz + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Regular polygon in the xz plane (first vertex at angle `phase`, degrees from +x). */
export const circle = (/** @type {number} */ r, /** @type {number} */ n, phase = 0) =>
  Array.from({ length: n }, (_, i) => /** @type {[number, number]} */ ([r * Math.cos(((phase + (360 * i) / n) * Math.PI) / 180), r * Math.sin(((phase + (360 * i) / n) * Math.PI) / 180)]));

/**
 * Collects coloured triangles; `build()` returns a faceted, vertex-coloured BufferGeometry.
 * `place` maps local points (lofts grow along +y) into the part's frame, e.g. to lay a loft along x.
 * @param {typeof import('three')} THREE
 */
export function shape(THREE) {
  /** @type {number[]} */ const pos = [], col = [], nor = [];
  const c = new THREE.Color();
  /** @type {(p: V3) => V3} */ let place = (p) => p;
  let mirrored = false;
  /** @type {(n: V3) => V3} */ const turn = (n) => { const o = place([0, 0, 0]), q = place(n); return [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; };
  const api = {
    /** Map later local points through fn (mirror = fn reflects, so the winding is flipped back). @param {(p: V3) => V3} fn */
    at(fn, mirror = false) { place = fn; mirrored = mirror; return api; },
    /** Flat polygon (convex, counter-clockwise seen from its front) in the plane z = const. @param {[number, number][]} pts @param {number} z @param {number} hex */
    plate(pts, z, hex) {
      for (let i = 1; i + 1 < pts.length; i++) api.tri([pts[0][0], pts[0][1], z], [pts[i][0], pts[i][1], z], [pts[i + 1][0], pts[i + 1][1], z], hex);
      return api;
    },
    /**
     * One triangle (degenerate ones are dropped); flat-shaded unless vertex normals are given.
     * @param {V3} a @param {V3} b @param {V3} d @param {number} hex @param {V3[]} [normals]
     */
    tri(a, b, d, hex, normals) {
      if (mirrored) { [b, d] = [d, b]; if (normals) normals = [normals[0], normals[2], normals[1]]; }
      [a, b, d] = [a, b, d].map(place);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = /** @type {V3} */ ([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]), len = Math.hypot(...n);
      if (len < 1e-9) return api;
      c.setHex(hex); // sRGB palette → linear working space
      pos.push(...a, ...b, ...d);
      for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
      for (const m of normals ? normals.map(turn) : [n, n, n]) { const l = Math.hypot(...m); nor.push(m[0] / l, m[1] / l, m[2] / l); }
      return api;
    },
    /**
     * Loft: rings of [x, z] points (same count, angle ascending) at heights y, joined bottom → top; flat caps.
     * colour(y, side, c) gets each face's mean height, 'side' | 'bottom' | 'top' and its local centroid c.
     * smooth: lathe shading, smooth around the axis and hard between rings (normals from the profile slope).
     * @param {{ y: number, pts: [number, number][] }[]} rings @param {(y: number, side: string, c: V3) => number} colour
     * @param {{ cx?: number, cz?: number, caps?: boolean, smooth?: boolean }} [o]
     */
    loft(rings, colour, { cx = 0, cz = 0, caps = true, smooth = false } = {}) {
      /** @type {(y: number, p: [number, number]) => V3} */ const P = (y, [x, z]) => [cx + x, y, cz + z];
      for (let r = 0; r + 1 < rings.length; r++) {
        const A = rings[r], B = rings[r + 1], n = A.pts.length;
        const rad = (/** @type {[number, number]} */ [x, z]) => Math.hypot(x, z);
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          /** Profile normal (dy, -dr) turned to vertex k's angle. @type {(k: number) => V3} */
          const N = (k) => {
            const dr = rad(B.pts[k]) - rad(A.pts[k]), dy = B.y - A.y, a = Math.atan2(A.pts[k][1] || B.pts[k][1], A.pts[k][0] || B.pts[k][0]);
            return [dy * Math.cos(a), -dr, dy * Math.sin(a)];
          };
          const [ni, nj] = smooth ? [N(i), N(j)] : [];
          const y = (A.y + B.y) / 2, hex = colour(y, 'side', [cx + (A.pts[i][0] + B.pts[j][0]) / 2, y, cz + (A.pts[i][1] + B.pts[j][1]) / 2]);
          api.tri(P(A.y, A.pts[i]), P(B.y, B.pts[i]), P(B.y, B.pts[j]), hex, smooth ? [ni, ni, nj] : undefined)
            .tri(P(A.y, A.pts[i]), P(B.y, B.pts[j]), P(A.y, A.pts[j]), hex, smooth ? [ni, nj, nj] : undefined);
        }
      }
      if (caps) {
        for (const [ring, top] of [[rings[0], false], [rings[rings.length - 1], true]]) {
          const { y, pts } = /** @type {{ y: number, pts: [number, number][] }} */ (ring), hex = colour(y, top ? 'top' : 'bottom', [cx, y, cz]);
          const mid = /** @type {V3} */ ([cx, y, cz]);
          for (let i = 0; i < pts.length; i++) {
            const a = P(y, pts[i]), b = P(y, pts[(i + 1) % pts.length]);
            if (top) api.tri(mid, b, a, hex); else api.tri(mid, a, b, hex);
          }
        }
      }
      return api;
    },
    /**
     * Rounded box: core half sizes, every edge rounded with radius r in `segs` steps (segs 1 = chamfer).
     * `cuts`: extra rings at these heights on the straight sides, so colour bands can change there.
     * @param {{ hx: number, hy: number, hz: number, r: number, segs?: number, cy?: number, cx?: number, cz?: number, cuts?: number[] }} b
     * @param {(y: number, side: string, c: V3) => number} colour
     */
    box({ hx, hy, hz, r, segs = 1, cy = 0, cx = 0, cz = 0, cuts = [] }, colour) {
      /** @type {{ y: number, pts: [number, number][] }[]} */ const rings = [];
      for (let k = 0; k <= 2 * segs + 1; k++) {
        const top = k > segs, a = ((top ? k - segs - 1 : k - segs) * 90) / segs * (Math.PI / 180); // -90…0, then 0…90
        if (k === segs + 1) for (const y of cuts) rings.push({ y, pts: roundedRect(hx, hz, r, segs) });
        rings.push({ y: cy + (top ? hy : -hy) + r * Math.sin(a), pts: roundedRect(hx, hz, r * Math.cos(a), segs) });
      }
      return api.loft(rings, colour, { cx, cz });
    },
    /** @param {number} [crease] degrees: if set, normals of coincident vertices whose faces differ less than this are averaged */
    build(crease) {
      if (crease) {
        const cos = Math.cos((crease * Math.PI) / 180), key = (/** @type {number} */ i) => `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
        /** @type {Map<string, number[]>} */ const at = new Map();
        for (let i = 0; i < pos.length; i += 3) at.set(key(i), [...(at.get(key(i)) ?? []), i]);
        const face = nor.slice(); // flat normals, one per vertex
        for (const list of at.values()) {
          for (const i of list) {
            const sum = [0, 0, 0];
            for (const j of list) {
              if (face[i] * face[j] + face[i + 1] * face[j + 1] + face[i + 2] * face[j + 2] < cos) continue;
              for (let k = 0; k < 3; k++) sum[k] += face[j + k];
            }
            const l = Math.hypot(...sum);
            for (let k = 0; k < 3; k++) nor[i + k] = sum[k] / l;
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      return geo;
    },
  };
  return api;
}
