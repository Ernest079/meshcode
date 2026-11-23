// @ts-check
// Loading baked asset files (files and hybrid variants). ?tex= picks the texture set:
//   png · webp  — decoded to RGBA on the GPU (4 B/texel)
//   uastc · etc1s — KTX2 / Basis Universal, transcoded to a GPU-compressed format (BC7, ASTC, ETC…)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { bakedTexture } from '../vfx.js';

const FORMATS = ['png', 'webp', 'uastc', 'etc1s'];
const q = new URLSearchParams(location.search).get('tex') ?? '';
export const TEX = FORMATS.includes(q) ? q : 'png';
const KTX2 = TEX === 'uastc' || TEX === 'etc1s';
const BASE = `./assets/${TEX}/`;

/** @type {Promise<import('three/addons/loaders/KTX2Loader.js').KTX2Loader> | undefined} */ let ktx2;
/** KTX2Loader in its own chunk, so the png/webp pages don't download it. @param {THREE.WebGLRenderer} renderer */
const ktx2Loader = (renderer) => (ktx2 ??= import('three/addons/loaders/KTX2Loader.js')
  .then(({ KTX2Loader }) => new KTX2Loader().detectSupport(renderer))); // the transcoder (JS + WASM) is bundled by Vite

/** The five models, in parallel. @param {THREE.WebGLRenderer} renderer */
export async function loadModels(renderer) {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (KTX2) gltf.setKTX2Loader(await ktx2Loader(renderer));
  const glb = (/** @type {string} */ name) => gltf.loadAsync(`${BASE}${name}.glb`).then((g) => g.scene);
  const [arena, crate, barrel, drone, bolt] = await Promise.all(['arena', 'crate', 'barrel', 'drone', 'bolt'].map(glb));
  return { arena, crate, barrel, drone, bolt };
}

// ImageBitmap with straight alpha (no premultiply on decode): the texels stay exactly as baked.
const bitmaps = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

/** The explosion flipbook and the particle sprite. @param {THREE.WebGLRenderer} renderer */
export async function loadEffects(renderer) {
  const image = KTX2
    ? async (/** @type {string} */ name) => bakedTexture(await (await ktx2Loader(renderer)).loadAsync(`${BASE}${name}.ktx2`))
    : (/** @type {string} */ name) => bitmaps.loadAsync(`${BASE}${name}.${TEX}`).then((bmp) => bakedTexture(new THREE.Texture(bmp)));
  const [flipbook, sprite] = await Promise.all([image('explosion'), image('spark')]);
  return { flipbook, sprite };
}
