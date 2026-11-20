// @ts-check
// Snapshots for vision models (AI visual critique): a 3D model from four angles, or a 2D image scaled to fit.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIDE = 384;
const DIRS = [[0, 0.25, 1], [1, 0.25, 0], [0, 1, 0.01], [1, 0.8, 1.2]]; // front, right, top, three-quarter
const b64 = (/** @type {HTMLCanvasElement} */ c) => c.toDataURL('image/png').split(',')[1];

/** @param {THREE.Object3D} root @returns {string[]} base64 PNGs */
export function renderViews(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(SIDE, SIDE, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9aa0a8); // mid grey: dark and light parts both read
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(root.clone()); // a clone shares geometry/materials and leaves the viewer's scene alone
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
    const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(35 / 2))) * 1.05;
    return DIRS.map((d) => {
      camera.position.copy(center).add(new THREE.Vector3(...d).normalize().multiplyScalar(dist));
      camera.lookAt(center);
      renderer.render(scene, camera);
      return b64(renderer.domElement);
    });
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** A 2D result for a vision model: at most 1024 px, small pixel art scaled up crisply. @param {HTMLCanvasElement} canvas */
export function imageView(canvas) {
  const k = Math.min(1024 / Math.max(canvas.width, canvas.height), Math.max(1, Math.floor(256 / Math.min(canvas.width, canvas.height))));
  const out = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(canvas.width * k)), height: Math.max(1, Math.round(canvas.height * k)) });
  const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
  ctx.imageSmoothingEnabled = k < 1;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return [b64(out)];
}
