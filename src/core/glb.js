// @ts-check
// Browser core: code → Object3D → GLB, GLB → Object3D, and scene stats.
// Runs unchanged in the web app and, through headless Chrome, in the CLI.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** @typedef {(three: typeof THREE) => THREE.Object3D | Promise<THREE.Object3D>} ModelFactory */

/**
 * Run a model factory (`export default (THREE) => Object3D`).
 * @param {ModelFactory} factory
 * @param {typeof THREE} [three] the namespace handed to the model (the web viewer passes one that records origins)
 * @returns {Promise<THREE.Object3D>}
 */
export async function runModel(factory, three = THREE) {
  if (typeof factory !== 'function') throw new TypeError('model module must `export default (THREE) => Object3D`');
  const root = await factory(three);
  if (!(root instanceof THREE.Object3D)) throw new TypeError('model factory must return a THREE.Object3D');
  root.updateMatrixWorld(true);
  return root;
}

/**
 * Sample `animate(root, t)` into one AnimationClip: position/quaternion/scale of every node that moves.
 * `animate` must set absolute values from t (no increments). The rest pose left on the nodes is t = 0.
 * @param {THREE.Object3D} root @param {(root: THREE.Object3D, t: number) => void} animate
 * @param {number} duration seconds @param {number} fps samples per second
 */
export function bakeAnimation(root, animate, duration, fps) {
  if (typeof animate !== 'function') throw new TypeError('`animate` must be a function: export const animate = (root, t) => { … }');
  if (!(duration > 0 && duration <= 600)) throw new RangeError(`\`duration\` must be between 0 and 600 seconds, got ${duration}`);
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) throw new RangeError(`\`fps\` must be a whole number from 1 to 120, got ${fps}`);
  /** @type {THREE.Object3D[]} */ const nodes = [];
  root.traverse((o) => nodes.push(o));
  const PROPS = /** @type {const} */ (['position', 'quaternion', 'scale']);
  const count = Math.round(duration * fps) + 1;
  const times = new Float32Array(count);
  const values = nodes.map(() => ({ position: /** @type {number[]} */ ([]), quaternion: /** @type {number[]} */ ([]), scale: /** @type {number[]} */ ([]) }));
  for (let i = 0; i < count; i++) {
    times[i] = (i / (count - 1)) * duration;
    animate(root, times[i]);
    nodes.forEach((o, k) => { for (const p of PROPS) values[k][p].push(...o[p].toArray()); });
  }
  animate(root, 0);
  root.updateMatrixWorld(true);
  /** @type {THREE.KeyframeTrack[]} */ const tracks = [];
  nodes.forEach((o, k) => {
    for (const p of PROPS) {
      const v = values[k][p], size = p === 'quaternion' ? 4 : 3;
      if (!v.some((x, j) => Math.abs(x - v[j % size]) > 1e-6)) continue; // never moves: no track
      // By uuid: names need not be unique (PropertyBinding and GLTFExporter both resolve uuids).
      tracks.push(new (p === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack)(`${o.uuid}.${p}`, times, v));
    }
  });
  return new THREE.AnimationClip(root.name || 'animation', duration, tracks);
}

/**
 * Run a model module: its default factory, plus the optional `animate` / `duration` / `fps` exports baked into `root.animations`.
 * @param {{ default: ModelFactory, animate?: (root: THREE.Object3D, t: number) => void, duration?: number, fps?: number }} mod
 * @param {typeof THREE} [three]
 */
export async function runModule(mod, three = THREE) {
  const root = await runModel(mod.default, three);
  if (mod.animate !== undefined) root.animations.push(bakeAnimation(root, mod.animate, /** @type {number} */ (mod.duration), mod.fps ?? 30));
  return root;
}

/**
 * Run model source text (a module with `export default (THREE) => Object3D`), imported from a blob URL.
 * @param {string} code @param {typeof THREE} [three]
 */
export async function runSource(code, three = THREE) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await runModule(await import(/* @vite-ignore */ url), three);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    if (/resolve module specifier/i.test(e.message)) e.message += ' — imports are not available here: use the THREE argument';
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export an Object3D as binary glTF.
 * @param {THREE.Object3D} root
 * @returns {Promise<ArrayBuffer>}
 */
export async function exportGLB(root) {
  const out = await new GLTFExporter().parseAsync(root, { binary: true, animations: root.animations });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary output');
  return out;
}

/**
 * Original encoded bytes of images embedded in a loaded GLB, keyed by THREE.Source,
 * so decompile can write the exact JPEG/PNG back instead of re-encoding decoded pixels.
 * @type {WeakMap<THREE.Source, { bytes: Uint8Array, mimeType: string }>}
 */
export const imageSources = new WeakMap();

/**
 * Parse a GLB (plain or EXT_meshopt_compression) into an Object3D.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadGLB(buffer) {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const { parser } = gltf;
  for (const [obj, ref] of parser.associations) {
    if (!(obj instanceof THREE.Texture) || ref.textures === undefined || imageSources.has(obj.source)) continue;
    const def = parser.json.textures[ref.textures];
    // ponytail: webp/avif/basisu extension sources skipped (decompile re-encodes them as PNG); map them if needed.
    if (def.extensions || def.source === undefined) continue;
    const img = parser.json.images[def.source];
    if (img.bufferView === undefined || !img.mimeType) continue;
    imageSources.set(obj.source, { bytes: new Uint8Array(await parser.getDependency('bufferView', img.bufferView)), mimeType: img.mimeType });
  }
  gltf.scene.animations = gltf.animations; // kept so decompile can warn they are not converted
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

/**
 * Mesh count, triangle count (instances included) and world bounding box.
 * @param {THREE.Object3D} root
 */
export function sceneStats(root) {
  let meshes = 0, instances = 0, triangles = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o instanceof THREE.InstancedMesh ? o.count : 1;
    meshes += 1;
    instances += n;
    triangles += tris * n;
  });
  // Non-precise mode on purpose: it is the path that accounts for InstancedMesh instances.
  const box = new THREE.Box3().setFromObject(root);
  return { meshes, instances, triangles, min: box.min.toArray(), max: box.max.toArray() };
}

/**
 * Load a model from a URL: `.glb` is parsed, anything else is imported as a model module.
 * @param {string} url
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadModelURL(url) {
  if (/\.glb(\?|$)/i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return loadGLB(await res.arrayBuffer());
  }
  return runModule(await import(url));
}
