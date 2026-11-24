// @ts-check
// The benchmark game, identical in every variant: an arena with props, 40 patrolling drones, and a bot
// camera that circles and fires plasma bolts → explosions with sparks, plus ambient dust.
// Only where the assets come from differs (variants/*.js). Everything on screen is an analytic function
// of time t, so a run is deterministic and frame-rate independent, and any instant can be rendered
// exactly: ?freeze=t (used by the visual equivalence gate). ?seconds=N runs the timed loop.
import * as THREE from 'three';
import { mulberry32 } from './layout.js';
import { explosionMaterial, particleMaterial, SPARK_LIFE } from './vfx.js';

/**
 * @typedef {{
 *   arena: THREE.Object3D, crate: THREE.Object3D, barrel: THREE.Object3D, drone: THREE.Object3D, bolt: THREE.Object3D,
 *   layout: import('./layout.js').Layout, flipbook: THREE.Texture | null, sprite: THREE.Texture | null,
 * }} Assets  flipbook / sprite: null = procedural shaders (code form of the effects)
 * @typedef {{ name: string, load: (renderer: THREE.WebGLRenderer) => Promise<Assets> }} Variant
 */

const SHOT_EVERY = 0.08, BOLT_SPEED = 32, BOOM_LIFE = 1.1, BOOM_SIZE = 2.6, MAX_FLIGHT = 2;
const SPARKS_PER_BOOM = 32, MAX_BOOMS = 64, MAX_BOLTS = 64, DUST = 3000;
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ the analytic world

/** The bot camera: an ellipse around the arena, looking at the centre. @param {number} t */
function cameraAt(t, pos = new THREE.Vector3(), target = new THREE.Vector3()) {
  const a = 0.11 * t + 0.6;
  pos.set(17 * Math.cos(a), 7 + 0.6 * Math.sin(0.37 * t), 15 * Math.sin(a));
  target.set(1.5 * Math.sin(0.23 * t), 1.2, 1.5 * Math.cos(0.19 * t));
  return { pos, target };
}

/** Drone d at time t: Lissajous patrol, bobbing, facing its velocity. @param {import('./layout.js').Patrol} d @param {number} t */
function droneMatrix(d, t, out = new THREE.Matrix4()) {
  const x = d.cx + d.ax * Math.sin(d.wx * t + d.px), z = d.cz + d.az * Math.sin(d.wz * t + d.pz);
  const y = d.height + 0.25 * Math.sin(d.bob * 2 * t + d.px);
  const yaw = Math.atan2(d.ax * d.wx * Math.cos(d.wx * t + d.px), d.az * d.wz * Math.cos(d.wz * t + d.pz));
  return out.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
}

/** Shot k: fired at k·SHOT_EVERY from below the camera at drone (13k mod N), explodes where the drone was. */
function makeShots(/** @type {import('./layout.js').Patrol[]} */ drones) {
  /** @type {{ fire: number, from: THREE.Vector3, to: THREE.Vector3, arrive: number, rot: number }[]} */
  const cache = [];
  return (/** @type {number} */ k) => {
    if (cache[k]) return cache[k];
    const fire = k * SHOT_EVERY;
    const { pos, target } = cameraAt(fire);
    const forward = target.clone().sub(pos).normalize();
    const from = pos.clone().addScaledVector(forward, 1.5).add(new THREE.Vector3(0, -1.2, 0));
    const to = new THREE.Vector3().setFromMatrixPosition(droneMatrix(drones[(k * 13) % drones.length], fire));
    return (cache[k] = { fire, from, to, arrive: fire + Math.min(from.distanceTo(to) / BOLT_SPEED, MAX_FLIGHT), rot: mulberry32(k + 1)() * Math.PI * 2 });
  };
}

/** One InstancedMesh per mesh of a template; part matrices relative to the template root are kept. */
function instancer(/** @type {THREE.Object3D} */ template, /** @type {number} */ count) {
  template.updateMatrixWorld(true);
  const group = new THREE.Group();
  /** @type {{ mesh: THREE.InstancedMesh, local: THREE.Matrix4, spin: boolean }[]} */ const parts = [];
  template.traverse((o) => {
    const m = /** @type {THREE.Mesh} */ (o);
    if (!m.isMesh) return;
    const mesh = new THREE.InstancedMesh(m.geometry, m.material, count);
    mesh.name = m.name;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances move: one stale bounding sphere would cull them wrongly
    group.add(mesh);
    parts.push({ mesh, local: m.matrixWorld.clone(), spin: m.name.startsWith('rotor') });
  });
  return { group, parts };
}

/** Bytes the scene keeps on the GPU, estimated from unique buffers and textures (mipmaps add ⅓). @param {THREE.Scene} scene */
function gpuBytes(scene) {
  const buffers = new Set(), textures = new Set(), formats = new Set();
  let geometry = 0, texture = 0;
  scene.traverse((o) => {
    const m = /** @type {any} */ (o);
    for (const a of [...Object.values(m.geometry?.attributes ?? {}), m.geometry?.index, m.instanceMatrix, m.instanceColor]) {
      if (a && !buffers.has(a.array)) { buffers.add(a.array); geometry += a.array.byteLength; }
    }
    for (const mat of [m.material].flat()) {
      for (const v of Object.values(mat ?? {}).concat(Object.values(mat?.uniforms ?? {}).map((u) => /** @type {any} */ (u).value))) {
        const t = /** @type {THREE.Texture} */ (v);
        if (!t?.isTexture || textures.has(t.source) || !t.image) continue;
        textures.add(t.source);
        const c = /** @type {THREE.CompressedTexture} */ (t);
        if (c.isCompressedTexture) { // KTX2: the transcoded blocks are what the GPU stores, mip chain included
          texture += c.mipmaps.reduce((s, m) => s + /** @type {any} */ (m).data.byteLength, 0);
          formats.add(FORMAT_NAMES[c.format] ?? String(c.format));
        } else texture += t.image.width * t.image.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
      }
    }
  });
  return { geometryBytes: geometry, textureBytes: Math.round(texture), textures: textures.size, compressedFormats: [...formats] };
}
/** GPU-compressed formats a KTX2 texture can be transcoded to, by three.js constant. */
const FORMAT_NAMES = {
  [THREE.RGBA_BPTC_Format]: 'BC7', [THREE.RGBA_ASTC_4x4_Format]: 'ASTC 4×4', [THREE.RGB_S3TC_DXT1_Format]: 'BC1',
  [THREE.RGBA_S3TC_DXT5_Format]: 'BC3', [THREE.RGB_ETC1_Format]: 'ETC1', [THREE.RGB_ETC2_Format]: 'ETC2', [THREE.RGBA_ETC2_EAC_Format]: 'ETC2 RGBA',
  [THREE.RGBA_PVRTC_4BPPV1_Format]: 'PVRTC', [THREE.RGBAFormat]: 'RGBA (uncompressed fallback)',
};

// ------------------------------------------------------------------ the game

/** @param {Variant} variant */
export async function start(variant) {
  performance.mark('mc:start');
  const bench = /** @type {any} */ ({ variant: variant.name, phases: {}, done: false });
  Object.assign(globalThis, { __bench: bench });
  const freeze = params.has('freeze') ? Number(params.get('freeze')) : null;
  const noVfx = params.has('novfx');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Number(params.get('dpr') ?? 1));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.append(renderer.domElement);

  const assets = await variant.load(renderer);
  performance.mark('mc:assets'); // downloaded + parsed/decoded (files) or generated (code)

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a3228, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(12, 25, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 120);

  assets.arena.traverse((o) => { o.castShadow = o.name !== 'floor'; o.receiveShadow = true; });
  scene.add(assets.arena);

  const { layout } = assets;
  const place = (/** @type {import('./layout.js').Placement} */ p) => new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY), new THREE.Vector3(p.scale, p.scale, p.scale));
  for (const [template, list] of /** @type {const} */ ([[assets.crate, layout.crates], [assets.barrel, layout.barrels]])) {
    const { group, parts } = instancer(template, list.length);
    list.forEach((p, i) => { const m = place(p); for (const part of parts) part.mesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, part.local)); });
    scene.add(group);
  }

  const drones = instancer(assets.drone, layout.drones.length);
  scene.add(drones.group);
  const bolts = instancer(assets.bolt, MAX_BOLTS);
  for (const p of bolts.parts) p.mesh.castShadow = false;

  const booms = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), explosionMaterial(assets.flipbook), MAX_BOOMS);
  booms.name = 'explosions';
  booms.frustumCulled = false;
  const boomAge = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOOMS), 1);
  const boomRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOOMS), 1);
  booms.geometry.setAttribute('aAge', boomAge);
  booms.geometry.setAttribute('aRot', boomRot);

  const sparkCount = MAX_BOOMS * SPARKS_PER_BOOM;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkAttr = {
    position: new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3),
    aVel: new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3),
    aBirth: new THREE.BufferAttribute(new Float32Array(sparkCount).fill(-1e6), 1),
    aSize: new THREE.BufferAttribute(new Float32Array(sparkCount), 1),
  };
  for (const [k, a] of Object.entries(sparkAttr)) sparkGeo.setAttribute(k, a);
  const sparks = new THREE.Points(sparkGeo, particleMaterial(assets.sprite, false));
  sparks.name = 'sparks';
  sparks.frustumCulled = false;

  const dustGeo = new THREE.BufferGeometry();
  const rand = mulberry32(99);
  const dustPos = new Float32Array(DUST * 3), dustSize = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dustPos.set([(rand() - 0.5) * 38, rand() * 6, (rand() - 0.5) * 38], i * 3);
    dustSize[i] = 0.05 + rand() * 0.08;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));
  dustGeo.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  dustGeo.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(DUST), 1));
  const dust = new THREE.Points(dustGeo, particleMaterial(assets.sprite, true));
  dust.name = 'dust';
  dust.frustumCulled = false;
  if (!noVfx) scene.add(bolts.group, booms, sparks, dust);
  performance.mark('mc:world'); // scene graph assembled

  const shot = makeShots(layout.drones);
  /** @type {number[]} */ const sparkOwner = new Array(MAX_BOOMS).fill(-1);
  const m4 = new THREE.Matrix4(), tmp = new THREE.Matrix4(), spin = new THREE.Matrix4(), q = new THREE.Quaternion();
  const v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), boomScale = new THREE.Vector3(BOOM_SIZE, BOOM_SIZE, BOOM_SIZE), px = new THREE.Vector2();

  /** Put everything where it is at time t. @param {number} t */
  function update(t) {
    const { pos, target } = cameraAt(t);
    camera.position.copy(pos);
    camera.lookAt(target);
    layout.drones.forEach((d, i) => {
      droneMatrix(d, t, m4);
      for (const p of drones.parts) {
        tmp.multiplyMatrices(m4, p.local);
        if (p.spin) tmp.multiply(spin.makeRotationY(t * 40 + i));
        p.mesh.setMatrixAt(i, tmp);
      }
    });
    for (const p of drones.parts) p.mesh.instanceMatrix.needsUpdate = true;
    if (noVfx) return;

    const first = Math.max(0, Math.floor((t - BOOM_LIFE - MAX_FLIGHT) / SHOT_EVERY)), last = Math.floor(t / SHOT_EVERY);
    let nb = 0, ne = 0;
    for (let k = first; k <= last; k++) {
      const s = shot(k);
      if (t < s.arrive && nb < MAX_BOLTS) { // in flight
        v.lerpVectors(s.from, s.to, (t - s.fire) / (s.arrive - s.fire));
        q.setFromRotationMatrix(m4.lookAt(s.to, s.from, THREE.Object3D.DEFAULT_UP)); // +Z towards the target
        m4.compose(v, q, one);
        for (const p of bolts.parts) p.mesh.setMatrixAt(nb, tmp.multiplyMatrices(m4, p.local));
        nb++;
      } else if (t >= s.arrive && t < s.arrive + BOOM_LIFE && ne < MAX_BOOMS) { // exploding
        booms.setMatrixAt(ne, m4.compose(s.to, q.identity(), boomScale));
        boomAge.setX(ne, (t - s.arrive) / BOOM_LIFE);
        boomRot.setX(ne, s.rot);
        ne++;
        const slot = k % MAX_BOOMS;
        if (sparkOwner[slot] !== k) { // sparks of shot k: written once, then the vertex shader moves them
          sparkOwner[slot] = k;
          const r = mulberry32(k * 7919 + 3);
          for (let j = 0; j < SPARKS_PER_BOOM; j++) {
            const i = slot * SPARKS_PER_BOOM + j, a = r() * Math.PI * 2, up = 1 + r() * 5, out = 2 + r() * 5;
            sparkAttr.position.setXYZ(i, s.to.x, s.to.y, s.to.z);
            sparkAttr.aVel.setXYZ(i, Math.cos(a) * out, up, Math.sin(a) * out);
            sparkAttr.aBirth.setX(i, s.arrive);
            sparkAttr.aSize.setX(i, 0.08 + r() * 0.1);
          }
          for (const a of Object.values(sparkAttr)) a.needsUpdate = true;
        }
      }
    }
    for (const p of bolts.parts) { p.mesh.count = nb; p.mesh.instanceMatrix.needsUpdate = true; }
    booms.count = ne;
    booms.instanceMatrix.needsUpdate = boomAge.needsUpdate = boomRot.needsUpdate = true;
    for (const mat of [/** @type {THREE.ShaderMaterial} */ (sparks.material), /** @type {THREE.ShaderMaterial} */ (dust.material)]) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uScale.value = renderer.getDrawingBufferSize(px).y / 2;
    }
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  update(freeze ?? 0);
  await renderer.compileAsync(scene, camera);
  performance.mark('mc:compiled'); // shader programs ready
  renderer.render(scene, camera); // textures and buffers go to the GPU here
  await new Promise((ok) => requestAnimationFrame(() => ok(undefined)));
  performance.mark('mc:first-frame');

  const mark = (/** @type {string} */ name) => performance.getEntriesByName(name)[0].startTime;
  for (const name of ['mc:start', 'mc:assets', 'mc:world', 'mc:compiled', 'mc:first-frame']) bench.phases[name.slice(3)] = mark(name);
  bench.render = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? 0 };
  bench.memory = { ...renderer.info.memory, ...gpuBytes(scene) };
  if (freeze !== null) {
    /** Render instant t (default: ?freeze) and read the frame back, for the equivalence gate. */
    bench.read = (t = freeze) => {
      update(t);
      renderer.render(scene, camera);
      const gl = renderer.getContext(), { width, height } = renderer.getDrawingBufferSize(new THREE.Vector2());
      const px = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = '';
      for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
      return { width, height, rgba: btoa(s) };
    };
    bench.ready = true;
    return;
  }

  // Timed run: wall-clock t, one frame per animation frame. Recorded for the harness (bench/run.mjs), per frame:
  //   frames — interval between animation frames (ms); cpu — main-thread time for update + render submission;
  //   gpu — GPU time of the frame's render (EXT_disjoint_timer_query_webgl2, results read back a few frames later).
  const seconds = Number(params.get('seconds') ?? 30);
  /** @type {number[]} */ const frames = [], cpu = [], gpu = [];
  const gl = /** @type {WebGL2RenderingContext} */ (renderer.getContext());
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  /** @type {WebGLQuery[]} */ const pending = [];
  const collect = () => {
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = /** @type {WebGLQuery} */ (pending.shift());
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
  };
  const t0 = performance.now();
  let prev = t0;
  bench.timer = !!timer;
  bench.ready = true;
  renderer.setAnimationLoop((now) => {
    const t = (now - t0) / 1000;
    if (t >= seconds) {
      renderer.setAnimationLoop(null);
      Object.assign(bench, { frames, cpu, gpu, done: true });
      return;
    }
    const c0 = performance.now();
    update(t); // CPU only (matrices, attributes); the uploads happen inside render, so the query starts here
    const q = timer && gl.createQuery();
    if (q) gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    renderer.render(scene, camera);
    if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push(q); }
    cpu.push(performance.now() - c0);
    if (timer) collect();
    frames.push(now - prev);
    prev = now;
  });
}
