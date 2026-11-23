// @ts-check
// Arena layout from a seed: where crates, barrels and drone patrols go. Plain JS (no three.js) so that
// the files variant can bake it to layout.json and the code / hybrid variants generate it at runtime.

export const ARENA = 40; // metres: square floor centred on the origin
export const SEED = 2026;

/** mulberry32: tiny seeded PRNG, same sequence everywhere. @param {number} seed */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {{ x: number, y: number, z: number, rotY: number, scale: number }} Placement
 * @typedef {{ cx: number, cz: number, ax: number, az: number, wx: number, wz: number, px: number, pz: number, height: number, bob: number }} Patrol
 * @typedef {{ seed: number, crates: Placement[], barrels: Placement[], drones: Patrol[] }} Layout
 */

/** @param {number} [seed] @returns {Layout} */
export function generateLayout(seed = SEED) {
  const rand = mulberry32(seed);
  const range = (/** @type {number} */ a, /** @type {number} */ b) => a + (b - a) * rand();
  const half = ARENA / 2 - 2.5; // keep clear of the walls
  /** @type {[number, number, number][]} */ const taken = []; // x, z, radius
  /** Rejection sampling: a free spot at least `r` from everything placed, outside the central plaza. */
  const spot = (/** @type {number} */ r) => {
    for (let tries = 0; tries < 500; tries++) {
      const x = range(-half, half), z = range(-half, half);
      if (Math.hypot(x, z) < 6) continue;
      if (taken.every(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) >= r + tr)) {
        taken.push([x, z, r]);
        return [x, z];
      }
    }
    throw new Error('layout: arena too crowded');
  };

  /** @type {Placement[]} */ const crates = [];
  for (let i = 0; i < 40; i++) { // clusters: a base crate, sometimes neighbours and a crate on top
    const [x, z] = spot(1.6);
    const rotY = range(0, Math.PI / 2);
    crates.push({ x, y: 0, z, rotY, scale: 1 });
    if (rand() < 0.55) crates.push({ x, y: 1, z, rotY: rotY + range(-0.3, 0.3), scale: 0.9 });
    if (rand() < 0.5) crates.push({ x: x + Math.cos(rotY) * 1.05, y: 0, z: z - Math.sin(rotY) * 1.05, rotY, scale: 1 });
  }
  /** @type {Placement[]} */ const barrels = [];
  for (let i = 0; i < 60; i++) {
    const [x, z] = spot(0.5);
    barrels.push({ x, y: 0, z, rotY: range(0, Math.PI * 2), scale: range(0.9, 1.1) });
  }
  /** @type {Patrol[]} */ const drones = [];
  for (let i = 0; i < 40; i++) {
    const a = range(0, Math.PI * 2), r = range(4, 14);
    drones.push({
      cx: Math.cos(a) * r, cz: Math.sin(a) * r,
      ax: range(1.5, 4), az: range(1.5, 4), wx: range(0.2, 0.5), wz: range(0.2, 0.5),
      px: range(0, Math.PI * 2), pz: range(0, Math.PI * 2), height: range(2.2, 4.5), bob: range(0.6, 1.4),
    });
  }
  return { seed, crates, barrels, drones };
}
