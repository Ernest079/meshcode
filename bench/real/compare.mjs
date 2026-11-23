// Model-level comparison for the real study (used while writing the code imitations, and by the gate):
//   node bench/real/compare.mjs <original.glb|.js> <imitation.glb|.js> [-o sheet.png]
// - silhouette IoU in 6 views (meshcode's fidelity metric, 256 px)
// - colour error: mean |ΔRGB| (0–255) over the pixels both models cover, in renderViews' 4 views (384 px)
// - a contact sheet: top row = original, bottom row = imitation
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyFiles, withPage } from '../../src/browser.mjs';

const BACKGROUND = [0x9a, 0xa0, 0xa8]; // renderViews' clear colour
const covered = (/** @type {Buffer} */ px, /** @type {number} */ i) => BACKGROUND.some((c, k) => Math.abs(px[i + k] - c) > 8);

/**
 * @param {string} a original @param {string} b imitation @param {string} [sheet] contact sheet path
 * @returns {Promise<{ iou: { mean: number, min: number, views: number[] }, colour: { mean: number, views: number[] }, tris: [number, number], materials: string[] }>}
 */
export async function compareModels(a, b, sheet) {
  [a, b] = [path.resolve(a), path.resolve(b)];
  const views = await withPage({ a: path.dirname(a), b: path.dirname(b) }, (page) => page.evaluate(async (urls) => {
    const core = await import('/meshcode/core/glb.js');
    const { renderViews } = await import('/meshcode/core/views.js');
    return Promise.all(urls.map(async (u) => renderViews(await core.loadModelURL(u))));
  }, [`/a/${encodeURIComponent(path.basename(a))}`, `/b/${encodeURIComponent(path.basename(b))}`]));

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'mc-compare-'));
  const files = await Promise.all(views.map((list, r) => Promise.all(list.map(async (b64, i) => {
    const f = path.join(tmp, `${r}-${i}.png`);
    await writeFile(f, Buffer.from(b64, 'base64'));
    return f;
  }))));
  const colourViews = files[0].map((fa, i) => {
    const [pa, pb] = [fa, files[1][i]].map((f) => execFileSync('convert', [f, '-depth', '8', 'rgba:-'], { maxBuffer: 1 << 26 }));
    let sum = 0, n = 0;
    for (let p = 0; p < pa.length; p += 4) {
      if (!covered(pa, p) || !covered(pb, p)) continue;
      sum += (Math.abs(pa[p] - pb[p]) + Math.abs(pa[p + 1] - pb[p + 1]) + Math.abs(pa[p + 2] - pb[p + 2])) / 3;
      n++;
    }
    return n ? sum / n : 255;
  });
  if (sheet) {
    const rows = files.map((list, r) => { const row = path.join(tmp, `row${r}.png`); execFileSync('convert', [...list, '+append', row]); return row; });
    execFileSync('convert', [...rows, '-append', '-resize', '1200x', sheet]);
  }
  const f = await verifyFiles(a, b);
  return {
    iou: { mean: f.mean, min: f.min, views: f.views },
    colour: { mean: colourViews.reduce((s, v) => s + v, 0) / colourViews.length, views: colourViews },
    tris: [f.a.triangles, f.b.triangles],
    materials: f.materials,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', short: 'o' } } });
  const r = await compareModels(positionals[0], positionals[1], values.out ?? 'compare.png');
  console.log(`IoU mean ${r.iou.mean.toFixed(3)} min ${r.iou.min.toFixed(3)} [${r.iou.views.map((v) => v.toFixed(3)).join(', ')}]`);
  console.log(`colour error ${r.colour.mean.toFixed(1)} [${r.colour.views.map((v) => v.toFixed(1)).join(', ')}]  tris ${r.tris[0]} → ${r.tris[1]}`);
  console.log(`sheet: ${values.out ?? 'compare.png'}`);
}
