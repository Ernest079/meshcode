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
import { coverage, encodeImage, renderImage } from '../../src/core/image.js';
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
/** @type {import('../../src/core/image.js').RenderedImage | null} */
let image2d = null;
let mode = '3d', frameIdx = 0, sheetView = false, timer = 0;

function draw2d() {
  if (!image2d) return;
  const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio, 2);
  view2d.width = W * dpr;
  view2d.height = H * dpr;
  const ctx = /** @type {CanvasRenderingContext2D} */ (view2d.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = dark ? '#111318' : '#f2f3f5';
  ctx.fillRect(0, 0, W, H);
  const { canvas: sheet, width, height, columns } = image2d;
  const [sw, sh] = sheetView ? [sheet.width, sheet.height] : [width, height];
  const [sx, sy] = sheetView ? [0, 0] : [(frameIdx % columns) * width, Math.floor(frameIdx / columns) * height];
  let scale = Math.min((W - 32) / sw, (H - 32) / sh);
  if (scale >= 2) scale = Math.floor(scale); // whole-number zoom keeps pixel art crisp
  const dw = sw * scale, dh = sh * scale, x = (W - dw) / 2, y = (H - dh) / 2;
  for (let cy = 0; cy < dh; cy += 10) { // checkerboard shows transparency
    for (let cx = 0; cx < dw; cx += 10) {
      ctx.fillStyle = ((cx + cy) / 10) % 2 ? (dark ? '#2a2d35' : '#d9dbe0') : (dark ? '#1e2027' : '#ffffff');
      ctx.fillRect(x + cx, y + cy, Math.min(10, dw - cx), Math.min(10, dh - cy));
    }
  }
  ctx.imageSmoothingEnabled = scale < 2;
  ctx.drawImage(sheet, sx, sy, sw, sh, x, y, dw, dh);
}

function animate2d() {
  clearInterval(timer);
  if (!image2d || sheetView || image2d.frames < 2) return draw2d();
  const { frames, fps } = image2d;
  timer = window.setInterval(() => {
    frameIdx = (frameIdx + 1) % frames;
    draw2d();
  }, 1000 / Math.max(1, fps));
  draw2d();
}
view2d.addEventListener('click', () => {
  sheetView = !sheetView;
  animate2d();
});

/** Show the 3D viewport or the 2D preview; the 3D render loop only runs when visible. @param {string} next */
function setMode(next) {
  if (next === mode) return;
  mode = next;
  renderer.domElement.style.display = mode === '3d' ? 'block' : 'none';
  view2d.style.display = mode === '2d' ? 'block' : 'none';
  renderer.setAnimationLoop(mode === '3d' ? loop : null);
  highlight([]);
  if (mode === '3d') clearInterval(timer);
}

function resize() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  draw2d();
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
  try {
    image2d = await renderImage(code);
    frameIdx = 0;
    animate2d();
    const png = await encodeImage(image2d.canvas, 'image/png');
    const { kind, width, height, frames, canvas } = image2d;
    send({ type: 'stats2d', kind, width, height, frames, sheetWidth: canvas.width, sheetHeight: canvas.height, pngBytes: png.byteLength });
    send({ type: 'ok', id, empty: coverage(canvas) === 0 });
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
      draw2d();
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
        if (!image2d) throw new Error('nothing to export yet');
        const mime = /** @type {const} */ ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' })[/** @type {'png'} */ (msg.format)];
        if (!mime) throw new Error(`unknown format ${msg.format}`);
        const buffer = await encodeImage(image2d.canvas, mime);
        send({ type: 'file', buffer, filename: `${image2d.frames > 1 ? 'spritesheet' : 'image'}.${msg.format}`, mime }, [buffer]);
      }
    } else if (msg.type === 'import') {
      imported = await loadGLB(msg.buffer);
      const r = await decompile(imported, { inlineTextures: true, source: msg.name });
      send({ type: 'decompiled', code: r.code, summary: r.summary, warnings: r.warnings });
    } else if (msg.type === 'capture') { // AI visual critique: snapshots of what is on screen
      const target = mode === '2d' ? image2d?.canvas : current;
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
Object.assign(globalThis, { meshcodeViewer: { camera, current: () => current, highlighted: () => highlighted.map((o) => o.name) } });

send({ type: 'ready' });
