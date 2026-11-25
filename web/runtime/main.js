// @ts-check
// Sandbox runtime. Runs inside <iframe sandbox="allow-scripts"> (opaque origin): user code executes here,
// never in the app's origin. Bundled into one file (vite.runtime.config.js) and handed over by postMessage,
// because an opaque-origin frame cannot fetch the app's modules (CORS).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { decompile } from '../../src/core/decompile.js';
import { toGodot, toUnity } from '../../src/core/engines.js';
import { materialDiff, silhouetteIoU } from '../../src/core/fidelity.js';
import { exportGLB, loadGLB, runSource, sceneStats } from '../../src/core/glb.js';
import { coverage, encodeImage, loadImageSource } from '../../src/core/image.js';
import { imageView, renderViews } from '../../src/core/views.js';

/** @param {Record<string, unknown>} msg @param {Transferable[]} [transfer] */
const send = (msg, transfer = []) => parent.postMessage(msg, '*', transfer);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.style.display = 'block';
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const selection = new THREE.Group(); // outlines of picked / highlighted objects
scene.add(selection);
const grid = new THREE.GridHelper(10, 20, 0x888888, 0x888888);
for (const m of [grid.material].flat()) Object.assign(m, { transparent: true, opacity: 0.35 }); // soft in both themes
scene.add(grid);

// ------------------------------------------------------------------ origins: which code created each object
// User code gets a THREE whose drawable classes record, at construction, where in that code they were
// created (stack frames → offsets, innermost first). Kept in a WeakMap: nothing leaks into exports.
Error.stackTraceLimit = 50;
const SELF = import.meta.url; // this runtime's own blob URL: its frames (three.js included) are skipped
/** @type {WeakMap<THREE.Object3D, number[]>} */
const origins = new WeakMap();
let lineStarts = [0]; // of the code being run
/** @param {any} Base */
const traced = (Base) => class extends Base {
  static [Symbol.hasInstance](/** @type {unknown} */ o) { return o instanceof Base; } // `x instanceof THREE.Mesh` keeps working
  constructor(/** @type {any[]} */ ...args) {
    super(...args);
    /** @type {number[]} */ const at = [];
    for (const line of (new Error().stack ?? '').split('\n')) {
      const m = /(blob:\S+?):(\d+):(\d+)\)?$/.exec(line);
      if (m && m[1] !== SELF) at.push((lineStarts[Number(m[2]) - 1] ?? 0) + Number(m[3]) - 1);
    }
    if (at.length) origins.set(this, at);
  }
};
const TRACED = /** @type {typeof THREE} */ ({
  ...THREE,
  ...Object.fromEntries(['Mesh', 'InstancedMesh', 'SkinnedMesh', 'Points', 'Line', 'LineSegments', 'LineLoop', 'Sprite']
    .map((k) => [k, traced(/** @type {any} */ (THREE)[k])])),
});

/** @type {THREE.Object3D | null} */
let current = null;
/** @type {THREE.AnimationMixer | null} */
let mixer = null; // plays current.animations (baked from the model's `animate` export)
const clock = new THREE.Clock();
/** @type {THREE.Object3D | null} */
let imported = null; // last imported GLB: the reference for AI refine checks
let pendingStats = false;
let dark = true;

// ------------------------------------------------------------------ 2D preview
const view2d = document.createElement('canvas');
view2d.style.display = 'none'; // inline display, not [hidden]: an inline display would override [hidden]
view2d.title = 'Click: animation ⇄ whole sheet';
document.body.append(view2d);
const liveCanvas = document.createElement('canvas'); // reused offscreen buffer for live vector/pixel frames
/** @type {import('../../src/core/image.js').LoadedImageSource | null} */
let source2d = null;
/** @type {import('../../src/core/image.js').RenderedImage | null} */
let baked2d = null;
/** @type {string | null} */
let clip2d = null;
/** @type {'auto' | 'smooth' | 'crisp'} */
let smoothMode = 'auto';
let mode = '3d', sheetView = false, playing2d = true;
let raf2d = 0, runGen2d = 0, startTime2d = 0, elapsed2d = 0, rendering2d = false;
let viewW = 0, viewH = 0, viewDpr = 1;

function sizeView2d() {
  const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio, 2);
  if (W === viewW && H === viewH && dpr === viewDpr) return;
  viewW = W;
  viewH = H;
  viewDpr = dpr;
  view2d.width = W * dpr;
  view2d.height = H * dpr;
}

/** @param {number} scale */
function resolveSmooth(scale) {
  if (smoothMode === 'smooth') return true;
  if (smoothMode === 'crisp') return false;
  return scale < 2;
}

/** @param {HTMLCanvasElement} img @param {number} logicalW @param {number} logicalH */
function blit2d(img, logicalW, logicalH) {
  sizeView2d();
  const W = viewW, H = viewH, dpr = viewDpr;
  const ctx = /** @type {CanvasRenderingContext2D} */ (view2d.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = dark ? '#111318' : '#f2f3f5';
  ctx.fillRect(0, 0, W, H);
  let scale = Math.min((W - 32) / logicalW, (H - 32) / logicalH);
  const useSmooth = resolveSmooth(scale);
  if (!useSmooth && scale >= 2) scale = Math.floor(scale); // whole-number zoom keeps pixel art crisp
  const dw = logicalW * scale, dh = logicalH * scale, x = (W - dw) / 2, y = (H - dh) / 2;
  for (let cy = 0; cy < dh; cy += 10) { // checkerboard shows transparency
    for (let cx = 0; cx < dw; cx += 10) {
      ctx.fillStyle = ((cx + cy) / 10) % 2 ? (dark ? '#2a2d35' : '#d9dbe0') : (dark ? '#1e2027' : '#ffffff');
      ctx.fillRect(x + cx, y + cy, Math.min(10, dw - cx), Math.min(10, dh - cy));
    }
  }
  ctx.imageSmoothingEnabled = useSmooth;
  if (useSmooth) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, img.width, img.height, x, y, dw, dh);
}

function stop2d() {
  cancelAnimationFrame(raf2d);
  raf2d = 0;
}

async function ensureBaked() {
  if (!source2d) throw new Error('nothing to export yet');
  if (!baked2d || baked2d.clip !== clip2d) baked2d = await source2d.bakeSheet(clip2d);
  return baked2d;
}

/** @param {number | null} pngBytes */
function sendStats2d(pngBytes) {
  if (!source2d) return;
  const spec = source2d.getClip(clip2d);
  send({
    type: 'stats2d',
    kind: source2d.kind,
    width: source2d.width,
    height: source2d.height,
    frames: spec.frames,
    fps: spec.fps,
    duration: spec.duration,
    sheetWidth: spec.sheetWidth,
    sheetHeight: spec.sheetHeight,
    pngBytes,
    clips: source2d.clipNames,
    clip: spec.name,
    smoothMode,
    playing: playing2d,
    sheetView,
  });
}

function sendView2d() {
  send({ type: 'view2d', smoothMode, playing: playing2d, sheetView });
}

/** Draw one live frame (or the whole sheet) at the current elapsed2d time. @param {number} gen */
async function draw2d(gen = runGen2d) {
  if (!source2d || gen !== runGen2d || rendering2d) return;
  rendering2d = true;
  try {
    if (sheetView) {
      const sheet = await ensureBaked();
      if (gen !== runGen2d) return;
      blit2d(sheet.canvas, sheet.canvas.width, sheet.canvas.height);
      return;
    }
    if (source2d.kind !== 'canvas') {
      const img = await ensureBaked();
      if (gen !== runGen2d) return;
      blit2d(img.canvas, img.width, img.height);
      return;
    }
    const spec = source2d.getClip(clip2d);
    const { width, height } = source2d;
    sizeView2d();
    const scale = Math.min((viewW - 32) / width, (viewH - 32) / height);
    const oversample = smoothMode === 'smooth'
      ? Math.min(4, Math.max(1, scale * viewDpr), 4096 / Math.max(width, height))
      : 1;
    const tw = Math.max(1, Math.round(width * oversample));
    const th = Math.max(1, Math.round(height * oversample));
    if (liveCanvas.width !== tw || liveCanvas.height !== th) {
      liveCanvas.width = tw;
      liveCanvas.height = th;
    }
    const lctx = /** @type {CanvasRenderingContext2D} */ (liveCanvas.getContext('2d'));
    if (typeof lctx.reset === 'function') lctx.reset();
    else { liveCanvas.width = tw; }
    if (tw !== width || th !== height) lctx.setTransform(tw / width, 0, 0, th / height, 0, 0);
    const t = spec.duration > 0
      ? (spec.loop ? elapsed2d % spec.duration : Math.min(elapsed2d, spec.duration))
      : 0;
    await source2d.renderFrame(lctx, { clip: clip2d, t });
    if (gen !== runGen2d) return;
    blit2d(liveCanvas, width, height);
  } catch (err) {
    stop2d();
    const e = /** @type {Error} */ (err);
    send({ type: 'error', message: `${e.name}: ${e.message}` });
  } finally {
    rendering2d = false;
  }
}

async function start2d() {
  stop2d();
  if (!source2d || mode !== '2d') return;
  const gen = runGen2d;
  const spec = source2d.getClip(clip2d);
  await draw2d(gen);
  if (gen !== runGen2d || sheetView || source2d.kind !== 'canvas' || (spec.frames < 2 && spec.duration <= 0) || !playing2d) return;
  startTime2d = performance.now() - elapsed2d * 1000;
  const tick = (/** @type {number} */ now) => {
    if (gen !== runGen2d || mode !== '2d' || sheetView || !playing2d) return;
    elapsed2d = (now - startTime2d) / 1000;
    void draw2d(gen);
    if (!spec.loop && spec.duration > 0 && elapsed2d >= spec.duration) {
      elapsed2d = spec.duration;
      playing2d = false;
      sendView2d();
      return;
    }
    raf2d = requestAnimationFrame(tick);
  };
  raf2d = requestAnimationFrame(tick);
}

view2d.addEventListener('click', () => {
  if (!source2d) return;
  const spec = source2d.getClip(clip2d);
  if (spec.frames < 2) return;
  sheetView = !sheetView;
  sendView2d();
  void start2d();
});

/** Show the 3D viewport or the 2D preview; the 3D render loop only runs when visible. @param {string} next */
function setMode(next) {
  if (next === mode) return;
  mode = next;
  renderer.domElement.style.display = mode === '3d' ? 'block' : 'none';
  view2d.style.display = mode === '2d' ? 'block' : 'none';
  renderer.setAnimationLoop(mode === '3d' ? loop : null);
  highlight([]);
  if (mode === '3d') stop2d();
}

function resize() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  if (mode === '2d') void draw2d();
}
addEventListener('resize', resize);
resize();

/** Frame the model: camera on a diagonal, grid at the model's base. @param {THREE.Object3D} root */
function frame(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(dist));
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  grid.position.set(center.x, box.min.y, center.z);
  grid.scale.setScalar(Math.max(radius / 2, 0.01));
  raycaster.params.Line.threshold = raycaster.params.Points.threshold = radius * 0.01;
}

// ------------------------------------------------------------------ pick ↔ code

const raycaster = new THREE.Raycaster();
/** @type {THREE.Object3D[]} */
let highlighted = [];

/** Outline objects (one instance of an InstancedMesh if `instance` is given). @param {THREE.Object3D[]} objects @param {number} [instance] */
function highlight(objects, instance) {
  for (const h of /** @type {THREE.Box3Helper[]} */ (selection.children)) {
    h.geometry.dispose();
    /** @type {THREE.Material} */ (h.material).dispose();
  }
  selection.clear();
  highlighted = objects;
  for (const o of objects) {
    const box = new THREE.Box3();
    const inst = /** @type {THREE.InstancedMesh} */ (o);
    if (instance !== undefined && inst.isInstancedMesh) {
      if (!inst.geometry.boundingBox) inst.geometry.computeBoundingBox();
      box.copy(/** @type {THREE.Box3} */ (inst.geometry.boundingBox)).applyMatrix4(inst.getMatrixAt(instance, new THREE.Matrix4())).applyMatrix4(inst.matrixWorld);
    } else {
      box.setFromObject(o);
    }
    const helper = new THREE.Box3Helper(box, 0xfacc15);
    /** @type {THREE.LineBasicMaterial} */ (helper.material).depthTest = false; // visible through other parts
    helper.renderOrder = 1;
    selection.add(helper);
  }
}

/** The frame that best tells this object apart: the one fewest other objects share, innermost on ties
 * (the `part('wing')` call, or the call inside a loop, rather than the `new THREE.Mesh` in the helper).
 * @param {THREE.Object3D} obj */
function bestOrigin(obj) {
  /** @type {Map<number, number>} */ const counts = new Map();
  current?.traverse((o) => { for (const at of origins.get(o) ?? []) counts.set(at, (counts.get(at) ?? 0) + 1); });
  const frames = /** @type {number[]} */ (origins.get(obj));
  return frames.reduce((best, at) => (/** @type {number} */ (counts.get(at)) < /** @type {number} */ (counts.get(best)) ? at : best));
}

// A click (not an orbit drag) picks the nearest object created by the user's code.
/** @type {number[] | null} */ let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || !current || e.button !== 0 || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObject(current, true).find((h) => origins.has(h.object));
  if (!hit) {
    highlight([]);
    return send({ type: 'picked', at: null });
  }
  highlight([hit.object], hit.instanceId);
  send({ type: 'picked', at: bestOrigin(hit.object), name: hit.object.name, instance: hit.instanceId ?? null });
});

/** @param {THREE.Object3D} root */
function show(root) {
  if (current) {
    scene.remove(current);
    current.traverse((o) => {
      const mesh = /** @type {THREE.Mesh} */ (o);
      mesh.geometry?.dispose();
      for (const m of [mesh.material].flat()) m?.dispose();
    });
  }
  mixer?.stopAllAction();
  mixer = root.animations.length ? new THREE.AnimationMixer(root) : null;
  for (const clip of root.animations) mixer?.clipAction(clip).play();
  current = root;
  highlight([]);
  scene.add(root);
  frame(root);
  pendingStats = true;
}

function loop() {
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
  if (pendingStats && current) {
    // renderer.info resets every frame, so read it right after the first frame of the new model.
    pendingStats = false;
    const stats = sceneStats(current);
    exportGLB(current)
      .then((glb) => send({ type: 'stats', stats, drawCalls: renderer.info.render.calls - 1, glbBytes: glb.byteLength }))
      .catch((err) => send({ type: 'error', message: `export: ${err.message}` }));
  }
}
renderer.setAnimationLoop(loop);

/** Replies to a run carry its id (the AI loop waits for them) and whether the result is empty.
 * @param {string} code @param {number} [id] */
async function run2d(code, id) {
  stop2d();
  const gen = ++runGen2d;
  try {
    const src = await loadImageSource(code);
    if (gen !== runGen2d) return;
    source2d = src;
    baked2d = null;
    clip2d = clip2d && src.clipNames.includes(clip2d) ? clip2d : src.defaultClip;
    smoothMode = src.smooth === true ? 'smooth' : src.smooth === false ? 'crisp' : 'auto';
    elapsed2d = 0;
    playing2d = true;
    const spec = src.getClip(clip2d);
    if (spec.frames < 2) sheetView = false;

    const smallSheet = spec.sheetWidth * spec.sheetHeight <= 1024 * 1024;
    let empty = false;
    /** @type {number | null} */ let pngBytes = null;
    if (src.kind !== 'canvas' || smallSheet || sheetView) {
      baked2d = await src.bakeSheet(clip2d);
      if (gen !== runGen2d) return;
      empty = coverage(baked2d.canvas) === 0;
      pngBytes = (await encodeImage(baked2d.canvas, 'image/png')).byteLength;
    } else {
      liveCanvas.width = src.width;
      liveCanvas.height = src.height;
      const lctx = /** @type {CanvasRenderingContext2D} */ (liveCanvas.getContext('2d'));
      await src.renderFrame(lctx, { clip: clip2d, frame: 0 });
      empty = coverage(liveCanvas) === 0;
      if (empty && spec.frames > 1) {
        if (typeof lctx.reset === 'function') lctx.reset();
        else liveCanvas.width = src.width;
        await src.renderFrame(lctx, { clip: clip2d, frame: Math.floor(spec.frames / 2) });
        empty = coverage(liveCanvas) === 0;
      }
    }
    if (gen !== runGen2d) return;
    sendStats2d(pngBytes);
    await start2d();
    send({ type: 'ok', id, empty });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    send({ type: 'error', id, message: `${e.name}: ${e.message}` });
  }
}

/** @param {string} code @param {number} [id] */
async function run(code, id) {
  try {
    lineStarts = [0, ...[...code.matchAll(/\n/g)].map((m) => /** @type {number} */ (m.index) + 1)];
    const root = await runSource(code, TRACED);
    show(root);
    send({ type: 'ok', id, empty: sceneStats(root).triangles === 0 });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    send({ type: 'error', id, message: `${e.name}: ${e.message}` });
  }
}

addEventListener('message', async (event) => {
  if (event.source !== parent) return;
  const msg = event.data;
  try {
    if (msg.type === 'run') {
      setMode(msg.mode);
      await (msg.mode === '2d' ? run2d(msg.code, msg.id) : run(msg.code, msg.id));
    } else if (msg.type === 'highlight') { // cursor in the editor: outline what that block of code creates
      /** @type {THREE.Object3D[]} */ const found = [];
      current?.traverse((o) => { if (origins.get(o)?.some((at) => at >= msg.from && at <= msg.to)) found.push(o); });
      highlight(found);
    } else if (msg.type === 'theme') {
      dark = msg.dark;
      scene.background = new THREE.Color(dark ? 0x111318 : 0xf2f3f5);
      if (mode === '2d') void draw2d();
    } else if (msg.type === 'setClip') {
      if (!source2d) return;
      clip2d = msg.clip ?? source2d.defaultClip;
      baked2d = null;
      elapsed2d = 0;
      playing2d = true;
      const spec = source2d.getClip(clip2d);
      if (spec.frames < 2) sheetView = false;
      /** @type {number | null} */ let pngBytes = null;
      if (spec.sheetWidth * spec.sheetHeight <= 1024 * 1024 || sheetView) {
        baked2d = await source2d.bakeSheet(clip2d);
        pngBytes = (await encodeImage(baked2d.canvas, 'image/png')).byteLength;
      }
      sendStats2d(pngBytes);
      await start2d();
    } else if (msg.type === 'setSmooth') {
      smoothMode = msg.mode === 'smooth' || msg.mode === 'crisp' ? msg.mode : 'auto';
      sendView2d();
      if (mode === '2d') void draw2d();
    } else if (msg.type === 'setPlaying') {
      if (!source2d) return;
      const spec = source2d.getClip(clip2d);
      playing2d = !!msg.playing;
      if (playing2d && !spec.loop && spec.duration > 0 && elapsed2d >= spec.duration) elapsed2d = 0;
      sendView2d();
      await start2d();
    } else if (msg.type === 'setSheetView') {
      if (!source2d) return;
      sheetView = !!msg.sheet;
      sendView2d();
      await start2d();
    } else if (msg.type === 'export') {
      if (msg.format === 'glb') {
        if (!current) throw new Error('nothing to export yet');
        const glb = await exportGLB(current);
        send({ type: 'file', buffer: glb, filename: `${current.name || 'model'}.glb`, mime: 'model/gltf-binary' }, [glb]);
      } else if (msg.format === 'godot' || msg.format === 'unity') {
        if (!current) throw new Error('nothing to export yet');
        const out = (msg.format === 'godot' ? toGodot : toUnity)(current);
        const buffer = new TextEncoder().encode(out.code).buffer;
        send({ type: 'file', buffer, filename: out.filename, mime: 'text/plain', warnings: out.warnings }, [buffer]);
      } else {
        const sheet = await ensureBaked();
        const mime = /** @type {const} */ ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' })[/** @type {'png'} */ (msg.format)];
        if (!mime) throw new Error(`unknown format ${msg.format}`);
        const buffer = await encodeImage(sheet.canvas, mime);
        if (mime === 'image/png') sendStats2d(buffer.byteLength);
        const base = sheet.clip && sheet.clips.length > 1
          ? `${sheet.clip}-${sheet.frames > 1 ? 'spritesheet' : 'image'}`
          : (sheet.frames > 1 ? 'spritesheet' : 'image');
        send({ type: 'file', buffer, filename: `${base}.${msg.format}`, mime }, [buffer]);
      }
    } else if (msg.type === 'import') {
      imported = await loadGLB(msg.buffer);
      const r = await decompile(imported, { inlineTextures: true, source: msg.name });
      send({ type: 'decompiled', code: r.code, summary: r.summary, warnings: r.warnings });
    } else if (msg.type === 'capture') { // AI visual critique: snapshots of what is on screen
      const target = mode === '2d' ? (await ensureBaked()).canvas : current;
      if (!target) throw new Error('nothing rendered yet');
      send({ type: 'captured', id: msg.id, images: mode === '2d' ? imageView(/** @type {HTMLCanvasElement} */ (target)) : renderViews(/** @type {THREE.Object3D} */ (target)) });
    } else if (msg.type === 'verify') { // AI refine: compare a candidate with the imported GLB, off screen
      if (!imported) throw new Error('import a GLB first');
      const root = await runSource(msg.code);
      send({ type: 'verified', id: msg.id, mean: silhouetteIoU(imported, root).mean, materials: materialDiff(imported, root) });
    }
  } catch (err) {
    const e = /** @type {Error} */ (err);
    send({ type: 'error', id: msg.id, message: msg.id ? `${e.name}: ${e.message}` : e.message });
  }
});

// Handle for devtools and the end-to-end test.
Object.assign(globalThis, {
  meshcodeViewer: {
    camera,
    current: () => current,
    highlighted: () => highlighted.map((o) => o.name),
    view2d: () => ({ clip: clip2d, smoothMode, playing: playing2d, sheetView }),
  },
});

send({ type: 'ready' });
