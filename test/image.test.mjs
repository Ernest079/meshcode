// 2D: code → PNG / JPG / WebP. Every 2D example must render at its declared size and not be empty.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildImageFile } from '../src/browser.mjs';
import { detectKind } from '../src/core/image.js';
import { ease, rig } from '../src/core/rig2d.js';

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

test('rig2d: stateless easing, analytical spring, phase/pingpong/remap, and volume-preserving node', () => {
  assert.equal(ease.linear(0.4), 0.4);
  assert.equal(ease.inOutCubic(0.5), 0.5);
  assert.ok(ease.outBack(0.6) > 1, 'outBack overshoots past 1');
  assert.equal(ease.outElastic(0), 0);
  assert.equal(ease.outElastic(1), 1);
  assert.ok(Math.abs(ease.outBounce(1) - 1) < 1e-6);

  // Analytical spring: 0 at t <= 0, overshoots when underdamped, converges to 1, 100% deterministic.
  assert.equal(ease.spring(0), 0);
  assert.equal(ease.spring(-0.5), 0);
  const under = ease.spring(0.25, { stiffness: 180, damping: 10 });
  assert.ok(under > 1, `underdamped spring overshoots (${under})`);
  assert.equal(ease.spring(0.25, { stiffness: 180, damping: 10 }), under, 'stateless & deterministic');
  assert.ok(Math.abs(ease.spring(5) - 1) < 1e-4, 'converges to 1');
  assert.ok(Math.abs(ease.spring(5, { stiffness: 100, damping: 20 }) - 1) < 1e-4, 'critically damped converges');
  assert.ok(Math.abs(ease.spring(5, { stiffness: 100, damping: 40 }) - 1) < 1e-4, 'overdamped converges');

  assert.ok(Math.abs(rig.phase(0.1, 0.25) - 0.85) < 1e-9);
  assert.ok(Math.abs(rig.pingpong(0.5) - 1) < 1e-9);
  assert.ok(Math.abs(rig.pingpong(0.75) - 0.5) < 1e-9);
  assert.equal(rig.lerp(10, 20, 0.25), 12.5);
  assert.equal(rig.clamp(5, 0, 2), 2);
  assert.ok(Math.abs(rig.remap(0.35, 0.2, 0.5, 0, 1) - 0.5) < 1e-9);

  // rig.node: saves/restores even on throw, applies volume-preserving squash (sx = 1/squash, sy = squash).
  /** @type {any[]} */ const calls = [];
  const fakeCtx = /** @type {any} */ ({
    globalAlpha: 1,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    translate: (/** @type {number} */ x, /** @type {number} */ y) => calls.push(['translate', x, y]),
    rotate: (/** @type {number} */ r) => calls.push(['rotate', r]),
    scale: (/** @type {number} */ sx, /** @type {number} */ sy) => calls.push(['scale', sx, sy]),
  });
  rig.node(fakeCtx, { x: 10, y: 20, rot: 0.5, squash: 1.25 }, () => calls.push(['draw']));
  const scaleCall = calls.find((c) => c[0] === 'scale');
  assert.ok(scaleCall && Math.abs(scaleCall[1] * scaleCall[2] - 1) < 1e-9, 'squash preserves volume');
  assert.equal(calls[0][0], 'save');
  assert.equal(calls.at(-1)[0], 'restore');

  calls.length = 0;
  assert.throws(() => rig.node(fakeCtx, { x: 1 }, () => { throw new Error('boom'); }), /boom/);
  assert.equal(calls.at(-1)[0], 'restore', 'restores ctx even if drawFn throws');
});

test('2D rigging runtime: duration+fps, auto-grid columns for 512×512×24, clips, and injected ease/rig', async () => {
  // Auto-grid: 24 frames at 512×512 would be 12288px in one row (> 8192); auto-columns wraps cleanly into a valid grid.
  const autoGrid = await tmpFile('autogrid.js', `export const size = [512, 512];
    export const duration = 1; export const fps = 24; export const smooth = true;
    export default (ctx, { width, height, t, u, ease, rig }) => {
      rig.node(ctx, { x: width / 2, y: height / 2, squash: 1 + 0.1 * Math.sin(u * Math.PI * 2) }, () => {
        ctx.fillStyle = '#7c3aed';
        ctx.beginPath();
        ctx.ellipse(0, 0, 80 * ease.outBack(Math.min(1, t + 0.2)), 80, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    };`);
  const gridOut = await buildImageFile(autoGrid, 'image/png');
  assert.equal(gridOut.meta.frames, 24);
  assert.ok(gridOut.meta.columns < 24 && gridOut.meta.sheetWidth <= 8192 && gridOut.meta.sheetHeight <= 8192);
  assert.deepEqual(pngSize(gridOut.bytes), [gridOut.meta.sheetWidth, gridOut.meta.sheetHeight]);
  assert.ok(gridOut.meta.coverage > 0.05);

  // Multi-clip module: different frame counts and distinct pixels per clip, plus clear error on unknown clip.
  const multi = await tmpFile('clips.js', `export const size = [64, 64]; export const smooth = true;
    export const clips = {
      idle: { duration: 0.5, fps: 8, loop: true },
      celebrate: { frames: 6, fps: 12, loop: false },
    };
    export default (ctx, { width, height, clip, u, rig }) => {
      ctx.fillStyle = clip === 'celebrate' ? '#f59e0b' : '#4f46e5';
      rig.node(ctx, { x: width / 2, y: height / 2, rot: u * Math.PI }, () => ctx.fillRect(-16, -16, 32, 32));
    };`);
  const idle = await buildImageFile(multi, 'image/png');
  assert.equal(idle.meta.clip, 'idle');
  assert.deepEqual(idle.meta.clips, ['idle', 'celebrate']);
  assert.equal(idle.meta.frames, 4);
  assert.deepEqual(pngSize(idle.bytes), [256, 64]);

  const celeb = await buildImageFile(multi, 'image/png', 0.92, 'celebrate');
  assert.equal(celeb.meta.clip, 'celebrate');
  assert.equal(celeb.meta.frames, 6);
  assert.deepEqual(pngSize(celeb.bytes), [384, 64]);

  await assert.rejects(buildImageFile(multi, 'image/png', 0.92, 'missing'), /unknown clip "missing"/);
});
