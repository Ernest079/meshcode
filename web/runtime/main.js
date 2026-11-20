// @ts-check
// Sandbox runtime. Runs inside <iframe sandbox="allow-scripts"> (opaque origin): user code executes here,
// never in the app's origin. Bundled into one file (vite.runtime.config.js) and handed over by postMessage,
// because an opaque-origin frame cannot fetch the app's modules (CORS).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { decompile } from '../../src/core/decompile.js';
import { exportGLB, loadGLB, runModel, sceneStats } from '../../src/core/glb.js';

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
const grid = new THREE.GridHelper(10, 20, 0x888888, 0x888888);
for (const m of [grid.material].flat()) Object.assign(m, { transparent: true, opacity: 0.35 }); // soft in both themes
scene.add(grid);

/** @type {THREE.Object3D | null} */
let current = null;
let pendingStats = false;

function resize() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
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
}

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
  current = root;
  scene.add(root);
  frame(root);
  pendingStats = true;
}

renderer.setAnimationLoop(() => {
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
});

/** @param {string} code */
async function run(code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    show(await runModel(mod.default));
    send({ type: 'ok' });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    const hint = /resolve module specifier/i.test(e.message) ? ' — imports are not available here: use the THREE argument' : '';
    send({ type: 'error', message: `${e.name}: ${e.message}${hint}` });
  } finally {
    URL.revokeObjectURL(url);
  }
}

addEventListener('message', async (event) => {
  if (event.source !== parent) return;
  const msg = event.data;
  try {
    if (msg.type === 'run') await run(msg.code);
    else if (msg.type === 'theme') scene.background = new THREE.Color(msg.dark ? 0x111318 : 0xf2f3f5);
    else if (msg.type === 'export') {
      if (!current) throw new Error('nothing to export yet');
      const glb = await exportGLB(current);
      send({ type: 'glb', buffer: glb, name: current.name || 'model' }, [glb]);
    } else if (msg.type === 'import') {
      const root = await loadGLB(msg.buffer);
      const r = await decompile(root, { inlineTextures: true, source: msg.name });
      send({ type: 'decompiled', code: r.code, summary: r.summary, warnings: r.warnings });
    }
  } catch (err) {
    send({ type: 'error', message: /** @type {Error} */ (err).message });
  }
});

send({ type: 'ready' });
