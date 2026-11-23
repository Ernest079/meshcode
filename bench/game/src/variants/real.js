// @ts-check
// Real study (phase 4.2): the props (crate, barrel, drone) are artists' CC0 models, delivered three ways —
//   ?props=glb         the original files (GLB + meshopt; ?tex=png as shipped, or uastc)
//   ?props=decompiled  meshcode decompile's module (geometry as data in JS) + the original atlas PNG
//   ?props=code        a parametric code imitation written by hand (bench/real/models/)
// Everything else is the code variant's: arena, bolt, effects (shaders) and layout (seeded).
import * as THREE from 'three';
import { start } from '../game.js';
import { generateLayout } from '../layout.js';
import arena from '../models/arena.js';
import bolt from '../models/bolt.js';
import { TEX } from './assets.js';

const PROPS = /** @type {'glb' | 'decompiled' | 'code'} */ (new URLSearchParams(location.search).get('props') ?? 'glb');
const NAMES = /** @type {const} */ (['crate', 'barrel', 'drone']);

// Same fit for every delivery, from the ORIGINAL's bounding box: uniform scale so its largest side matches the
// controlled prop (crate 1.0 m, barrel 0.9 m, drone 1.31 m), then props stand on the floor, the drone is centred.
const FIT = {
  crate: { scale: 1.0 / 0.52, offset: [0, 0, 0] }, // cargo_A: 0.5 × 0.52 × 0.52, already on the floor
  barrel: { scale: 0.9 / 1.0, offset: [0, 0.5, 0] }, // Barrel_A: 1 m cube centred on the origin
  drone: { scale: 1.31 / 1.2, offset: [0, -0.4375, -0.0555] }, // enemy-flying: 1.2 × 0.875 × 0.758
};
/** @param {THREE.Object3D} model @param {typeof NAMES[number]} name */
function fit(model, name) {
  const { scale, offset } = FIT[name], group = new THREE.Group();
  model.scale.multiplyScalar(scale);
  model.position.add(new THREE.Vector3(...offset).multiplyScalar(scale));
  group.add(model);
  return group;
}

/** Run a generator and record how long it took (__bench.generate, ms). @template T @param {string} name @param {() => T} fn */
const timed = (name, fn) => {
  const t = performance.now(), out = fn();
  /** @type {any} */ (globalThis).__bench.generate = { .../** @type {any} */ (globalThis).__bench.generate, [name]: performance.now() - t };
  return out;
};

/** @param {THREE.WebGLRenderer} renderer @returns {Promise<THREE.Object3D[]>} */
async function loadProps(renderer) {
  if (PROPS === 'glb') {
    const glb = await (await import('./assets.js')).glbLoader(renderer);
    return Promise.all(NAMES.map((n) => glb(`./assets/real/${TEX}/${n}.glb`)));
  }
  if (PROPS === 'decompiled') { // served as is from public/: a decompiled module is a standalone file
    return Promise.all(NAMES.map(async (n) => (await import(/* @vite-ignore */ new URL(`./real/decompiled/${n}.js`, location.href).href)).default(THREE)));
  }
  const models = await import('../../../real/models/props.js');
  return NAMES.map((n) => timed(n, () => models[n](THREE)));
}

start({
  name: PROPS === 'glb' ? `real-glb-${TEX}` : `real-${PROPS}`,
  load: async (renderer) => {
    const [props, a, b] = await Promise.all([loadProps(renderer), timed('arena', () => arena(THREE)), timed('bolt', () => bolt(THREE))]);
    const [crate, barrel, drone] = props.map((m, i) => fit(m, NAMES[i]));
    return { arena: a, bolt: b, crate, barrel, drone, layout: generateLayout(), flipbook: null, sprite: null };
  },
});
