// Builds the benchmark (pnpm bench:build). The code variant's sources are the single source of truth;
// every file the other variants download is baked from them, so the three variants show the same
// geometry, materials, layout and effects (checked by bench/equivalence.mjs):
//   1. models → GLB with meshcode (headless Chrome) → dedup + meshopt              assets/png/*.glb
//   2. the same GLBs with their textures re-encoded as WebP (EXT_texture_webp)       assets/webp/*.glb
//   3. the same GLBs with KTX2 / Basis Universal textures, UASTC and ETC1S (KHR_texture_basisu)  assets/{uastc,etc1s}/*.glb
//   4. effects: explosion flipbook + particle sprite rendered from the shaders       assets/{png,webp,uastc,etc1s}/
//   5. layout.json from the same seeded generator                                    assets/layout.json
//   6. real study (4.2): the artists' CC0 models (bench/real/source) packed as GLB    assets/real/{png,png128,uastc}/*.glb
//      (png128: palette atlases box-downsampled to ≤ 128 px with ImageMagick — the files-side best practice)
//      and decompiled by meshcode into model modules + their atlas                 public/real/decompiled/
//   7. vite build of the pages (KTX2Loader bundles three.js's Basis transcoder)     bench/dist/
// KTX2 encoding uses the official Basis Universal encoder (WASM, bench/vendor/basis/), run here in Node.
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureBasisu } from '@gltf-transform/extensions';
import { listTextureSlots } from '@gltf-transform/functions';
import { build } from 'vite';
import { buildFile, decompileFile, withPage } from '../src/browser.mjs';
import { meshoptGLB } from '../src/optimize.mjs';
import { generateLayout } from './game/src/layout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'game/src');
const OUT = path.join(HERE, 'game/public/assets');
const MODELS = ['arena', 'crate', 'barrel', 'drone', 'bolt'];
const FORMATS = ['png', 'webp', 'uastc', 'etc1s'];
export const WEBP_QUALITY = 0.9;
export const ETC1S_QUALITY = 128; // basisu's default (1–255)

const BASIS = await createRequire(import.meta.url)('./vendor/basis/basis_encoder.js')();
BASIS.initializeBasis();
/**
 * PNG → KTX2 with the Basis Universal encoder's defaults: UASTC LDR 4×4 + Zstandard (level 2, no RDO),
 * or ETC1S at quality 128. Color textures are sRGB; effect sheets hold shader output (linear data).
 * @param {Uint8Array} png @param {'uastc' | 'etc1s'} mode @param {{ srgb: boolean, mips: boolean }} o
 */
function toKTX2(png, mode, { srgb, mips }) {
  const enc = new BASIS.BasisEncoder();
  try {
    enc.setSliceSourceImage(0, png, 0, 0, BASIS.ldr_image_type.cPNGImage.value);
    enc.setCreateKTX2File(true);
    enc.setFormatMode(mode === 'uastc' ? BASIS.basis_tex_format.cUASTC_LDR_4x4.value : BASIS.basis_tex_format.cETC1S.value);
    if (mode === 'uastc') enc.setKTX2UASTCSupercompression(true);
    else enc.setQualityLevel(ETC1S_QUALITY);
    enc.setKTX2AndBasisSRGBTransferFunc(srgb);
    enc.setPerceptual(srgb);
    enc.setMipGen(mips);
    enc.setMipSRGB(srgb);
    enc.setMipWrapping(true); // ponytail: every model texture treated as repeating (only the crate's clamps; affects 1-px mip edges)
    enc.setStatusOutput(false);
    const out = new Uint8Array(png.length * 4 + (1 << 20));
    const n = enc.encode(out);
    if (!n) throw new Error(`Basis ${mode} encoding failed`);
    return out.slice(0, n);
  } finally {
    enc.delete();
  }
}

const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
const t0 = performance.now();
await rm(OUT, { recursive: true, force: true });
await Promise.all(FORMATS.map((d) => mkdir(path.join(OUT, d), { recursive: true })));

// 1–3 run in one headless page: WebP encoding and effect baking need a browser.
await withPage({ bench: SRC }, async (page) => {
  /** Encode images as WebP in the page. @param {Uint8Array[]} images */
  const toWebP = (images) => page.evaluate(async ({ list, quality }) => Promise.all(list.map(async (b64) => {
    const bmp = await createImageBitmap(new Blob([globalThis.__fromB64(b64)]));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bmp, 0, 0);
    return globalThis.__toB64(await (await canvas.convertToBlob({ type: 'image/webp', quality })).arrayBuffer());
  })), { list: images.map((b) => Buffer.from(b).toString('base64')), quality: WEBP_QUALITY })
    .then((list) => list.map((b64) => new Uint8Array(Buffer.from(b64, 'base64'))));

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const MIME = { webp: 'image/webp', uastc: 'image/ktx2', etc1s: 'image/ktx2' };
  for (const name of MODELS) {
    const { glb, stats } = await buildFile(path.join(SRC, 'models', `${name}.js`));
    const png = await meshoptGLB(glb);
    await writeFile(path.join(OUT, 'png', `${name}.glb`), png);
    /** @type {Record<string, number>} */ const sizes = { png: png.length };
    for (const fmt of /** @type {const} */ (['webp', 'uastc', 'etc1s'])) {
      const doc = await io.readBinary(new Uint8Array(glb));
      const textures = doc.getRoot().listTextures();
      if (textures.length) {
        const images = textures.map((t) => /** @type {Uint8Array} */ (t.getImage()));
        const out = fmt === 'webp' ? await toWebP(images) : images.map((png, i) => toKTX2(png, fmt, {
          srgb: listTextureSlots(textures[i]).some((s) => /baseColor|emissive/.test(s)), mips: true,
        }));
        textures.forEach((t, i) => t.setImage(out[i]).setMimeType(MIME[fmt]).setURI(''));
        doc.createExtension(fmt === 'webp' ? EXTTextureWebP : KHRTextureBasisu).setRequired(true);
      }
      const file = await meshoptGLB(await io.writeBinary(doc));
      await writeFile(path.join(OUT, fmt, `${name}.glb`), file);
      sizes[fmt] = file.length;
    }
    console.log(`${name.padEnd(7)} ${String(stats.triangles).padStart(7)} tris  raw ${kb(glb.length)} → ${Object.entries(sizes).map(([f, n]) => `${f} ${kb(n)}`).join(' · ')}`);
  }

  const effects = await page.evaluate(async (quality) => {
    const vfx = await import('/bench/vfx.js');
    const encode = async (/** @type {any} */ renderer, /** @type {string} */ type) => {
      const blob = await new Promise((ok) => renderer.domElement.toBlob(ok, type, quality));
      return globalThis.__toB64(await /** @type {Blob} */ (blob).arrayBuffer());
    };
    /** @type {Record<string, string>} */ const out = {};
    for (const [name, bake] of [['explosion', vfx.bakeFlipbook], ['spark', vfx.bakeSprite]]) {
      const renderer = bake();
      out[`${name}.png`] = await encode(renderer, 'image/png');
      out[`${name}.webp`] = await encode(renderer, 'image/webp');
      renderer.dispose();
    }
    return out;
  }, WEBP_QUALITY);
  for (const [file, b64] of Object.entries(effects)) {
    const bytes = Buffer.from(b64, 'base64');
    await writeFile(path.join(OUT, file.endsWith('.png') ? 'png' : 'webp', file), bytes);
    console.log(`${file.padEnd(14)} ${kb(bytes.length)}`);
    if (!file.endsWith('.png')) continue;
    for (const mode of /** @type {const} */ (['uastc', 'etc1s'])) { // no mipmaps: they would bleed between flipbook tiles
      const ktx2 = toKTX2(new Uint8Array(bytes), mode, { srgb: false, mips: false });
      await writeFile(path.join(OUT, mode, file.replace('.png', '.ktx2')), ktx2);
      console.log(`${file.replace('.png', '.ktx2').padEnd(14)} ${kb(ktx2.length)} (${mode})`);
    }
  }
});

// 6. Real study: originals packed (as shipped: PNG atlas; and UASTC), meshopt like every other GLB; the
// unoptimised pack is kept in bench/real/build/ as the reference for decompile and the model-level gate.
export const ATLAS = 128; // px, the downsampled palette atlas of the png128 sub-condition
export const REAL = { crate: 'kaykit-space/cargo_A.gltf', barrel: 'kaykit-prototype/Barrel_A.gltf', drone: 'kenney-fps/enemy-flying.glb' };
const REAL_BUILD = path.join(HERE, 'real/build'), DECOMPILED = path.join(HERE, 'game/public/real/decompiled');
await Promise.all([REAL_BUILD, DECOMPILED, path.join(OUT, 'real/png'), path.join(OUT, 'real/png128'), path.join(OUT, 'real/uastc')].map((d) => mkdir(d, { recursive: true })));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, source] of Object.entries(REAL)) {
  const doc = await io.read(path.join(HERE, 'real/source', source));
  const packed = await io.writeBinary(doc);
  await writeFile(path.join(REAL_BUILD, `${name}.glb`), packed);
  const png = await meshoptGLB(packed);
  await writeFile(path.join(OUT, 'real/png', `${name}.glb`), png);
  const smallDoc = await io.readBinary(packed);
  for (const t of smallDoc.getRoot().listTextures()) {
    t.setImage(execFileSync('convert', ['png:-', '-filter', 'Box', '-resize', `${ATLAS}x${ATLAS}>`, 'png:-'], { input: /** @type {Uint8Array} */ (t.getImage()) }));
  }
  const png128 = await meshoptGLB(await io.writeBinary(smallDoc));
  await writeFile(path.join(OUT, 'real/png128', `${name}.glb`), png128);
  for (const t of doc.getRoot().listTextures()) {
    const srgb = listTextureSlots(t).some((s) => /baseColor|emissive/.test(s));
    t.setImage(toKTX2(/** @type {Uint8Array} */ (t.getImage()), 'uastc', { srgb, mips: true })).setMimeType('image/ktx2').setURI('');
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const uastc = await meshoptGLB(await io.writeBinary(doc));
  await writeFile(path.join(OUT, 'real/uastc', `${name}.glb`), uastc);
  const d = await decompileFile(path.join(REAL_BUILD, `${name}.glb`), path.join(DECOMPILED, `${name}.js`));
  console.log(`real ${name.padEnd(7)} packed ${kb(packed.length)} → png ${kb(png.length)} · png128 ${kb(png128.length)} · uastc ${kb(uastc.length)} · decompiled ${kb(d.code.length)} + ${d.textureFiles.join(', ')} (IoU ${d.fidelity.mean.toFixed(3)})`);
}

const layout = JSON.stringify(generateLayout());
await writeFile(path.join(OUT, 'layout.json'), layout);
console.log(`layout.json    ${kb(layout.length)}`);

await build({ configFile: path.join(HERE, 'vite.config.js') });
console.log(`built bench/dist in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
