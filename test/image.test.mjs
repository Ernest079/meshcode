// 2D: code → PNG / JPG / WebP. Every 2D example must render at its declared size and not be empty.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildImageFile } from '../src/browser.mjs';
import { detectKind } from '../src/core/image.js';

/** Width/height from a PNG's IHDR chunk. @param {Buffer} png */
const pngSize = (png) => {
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', 'PNG signature');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};
const tmpFile = async (/** @type {string} */ name, /** @type {string} */ body) => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'meshcode-')), name);
  await writeFile(file, body);
  return file;
};

test('detectKind: canvas module, SVG (with prolog/comments), HTML', () => {
  assert.equal(detectKind('export default (ctx) => {}'), 'canvas');
  assert.equal(detectKind('<?xml version="1.0"?>\n<!-- icon -->\n<svg viewBox="0 0 1 1"></svg>'), 'svg');
  assert.equal(detectKind('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg></svg>'), 'svg');
  assert.equal(detectKind('<!-- size: 10x10 --><style></style><div></div>'), 'html');
  assert.equal(detectKind('<!doctype html><p>hi</p>'), 'html');
});

for (const file of readdirSync('examples/2d')) {
  test(`examples/2d/${file} renders to PNG at its declared size`, async () => {
    const { bytes, meta } = await buildImageFile(`examples/2d/${file}`, 'image/png');
    assert.deepEqual(pngSize(bytes), [meta.sheetWidth, meta.sheetHeight]);
    assert.equal(meta.sheetWidth, meta.width * meta.columns);
    assert.equal(meta.sheetHeight, meta.height * Math.ceil(meta.frames / meta.columns));
    assert.ok(meta.coverage > 0.05, `mostly empty image (${meta.coverage})`);
  });
}

test('sprite sheets: frames laid out by columns', async () => {
  const file = await tmpFile('sheet.js', `export const size = [10, 8]; export const frames = 5; export const columns = 2;
    export default (ctx, { frame }) => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 2 + frame, 8); };`);
  const { bytes, meta } = await buildImageFile(file, 'image/png');
  assert.deepEqual(pngSize(bytes), [20, 24]); // 2 columns × 3 rows
  assert.equal(meta.frames, 5);
});

test('JPEG and WebP outputs carry the right signatures', async () => {
  const jpg = (await buildImageFile('examples/2d/item-icons.svg', 'image/jpeg')).bytes;
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const webp = (await buildImageFile('examples/2d/item-icons.svg', 'image/webp')).bytes;
  assert.equal(webp.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString('latin1'), 'WEBP');
});

test('forgiving HTML (void tags, named entities) still renders', async () => {
  const file = await tmpFile('loose.html', '<!-- size: 120x40 --><style>p{margin:0;background:#4f46e5;color:#fff}</style><p>one<br>two&nbsp;&copy;<img></p>');
  const { bytes, meta } = await buildImageFile(file, 'image/png');
  assert.deepEqual(pngSize(bytes), [120, 40]);
  assert.ok(meta.coverage > 0.2);
});

test('clear errors: invalid SVG and absurd sizes', async () => {
  await assert.rejects(buildImageFile(await tmpFile('bad.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'), 'image/png'), /invalid SVG/);
  await assert.rejects(buildImageFile(await tmpFile('huge.js', 'export const size = [50000, 10]; export default () => {};'), 'image/png'), /between 1 and 8192/);
});
