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
 * @returns {Promise<THREE.Object3D>}
 */
export async function runModel(factory) {
  if (typeof factory !== 'function') throw new TypeError('model module must `export default (THREE) => Object3D`');
  const root = await factory(THREE);
  if (!(root instanceof THREE.Object3D)) throw new TypeError('model factory must return a THREE.Object3D');
  root.updateMatrixWorld(true);
  return root;
}

/**
 * Export an Object3D as binary glTF.
 * @param {THREE.Object3D} root
 * @returns {Promise<ArrayBuffer>}
 */
export async function exportGLB(root) {
  const out = await new GLTFExporter().parseAsync(root, { binary: true });
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
  return runModel((await import(url)).default);
}
