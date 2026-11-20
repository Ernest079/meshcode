// Procedural forest — techniques: a seeded PRNG (change SEED for a new forest), rejection sampling
// for spacing, a displaced ground whose height function also places every tree, and InstancedMesh
// with per-instance colour so hundreds of parts cost only a handful of draw calls.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const SEED = 42, TREES = 60, RADIUS = 7, MIN_GAP = 0.85;

  // mulberry32: tiny, fast, good-enough PRNG. Same SEED → same forest.
  let s = SEED >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (/** @type {number} */ a, /** @type {number} */ b) => a + rand() * (b - a);
  // Rolling hills; used for the ground mesh AND to sit each tree on it.
  const height = (/** @type {number} */ x, /** @type {number} */ z) => 0.25 * Math.sin(x * 0.7) * Math.cos(z * 0.6) + 0.12 * Math.sin(x * 1.7 + z * 1.3);

  const forest = new THREE.Group();
  forest.name = 'forest';

  const groundGeo = new THREE.CircleGeometry(RADIUS + 1.2, 72, 0, Math.PI * 2);
  groundGeo.rotateX(-Math.PI / 2);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ name: 'grass', color: 0x4f7d34, roughness: 1, flatShading: true }));
  ground.name = 'ground';
  forest.add(ground);

  // Scatter trees with a minimum gap; keep a clearing in the middle.
  /** @type {{ x: number, z: number, size: number, pine: boolean }[]} */
  const trees = [];
  for (let tries = 0; trees.length < TREES && tries < 5000; tries++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * RADIUS;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (r < 1.6 || trees.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_GAP)) continue;
    trees.push({ x, z, size: range(0.7, 1.35), pine: rand() < 0.6 });
  }
  const pines = trees.filter((t) => t.pine), oaks = trees.filter((t) => !t.pine);

  /** InstancedMesh whose per-instance colours multiply a white material. */
  const instanced = (/** @type {string} */ name, /** @type {THREE.BufferGeometry} */ geo, /** @type {number} */ count) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ name, roughness: 0.9, flatShading: true }), count);
    mesh.name = name;
    forest.add(mesh);
    return mesh;
  };
  const trunks = instanced('trunks', new THREE.CylinderGeometry(0.07, 0.11, 1, 6).translate(0, 0.5, 0), trees.length);
  const needles = instanced('pine_layers', new THREE.ConeGeometry(0.6, 1, 7).translate(0, 0.5, 0), pines.length * 3);
  const leaves = instanced('oak_canopy', new THREE.IcosahedronGeometry(0.55, 0), oaks.length * 3);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), color = new THREE.Color();
  const SRGB = THREE.SRGBColorSpace; // HSL values below are picked as on-screen (sRGB) colours
  const yaw = () => q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
  let k = 0;
  trees.forEach((t, i) => {
    const y = height(t.x, t.z);
    m.compose(new THREE.Vector3(t.x, y, t.z), yaw(), new THREE.Vector3(t.size, t.size * (t.pine ? 1.1 : 1.3), t.size));
    trunks.setMatrixAt(i, m);
    trunks.setColorAt(i, color.setHSL(0.07, 0.45, range(0.18, 0.26), SRGB));
    if (!t.pine) return;
    for (let layer = 0; layer < 3; layer++, k++) { // three stacked cones, each smaller and higher
      const w = t.size * (1 - layer * 0.25);
      m.compose(new THREE.Vector3(t.x, y + t.size * (0.55 + layer * 0.45), t.z), yaw(), new THREE.Vector3(w, t.size * 0.9, w));
      needles.setMatrixAt(k, m);
      needles.setColorAt(k, color.setHSL(range(0.3, 0.36), 0.5, range(0.2, 0.3), SRGB));
    }
  });
  oaks.forEach((t, i) => {
    const y = height(t.x, t.z) + t.size * 1.45;
    for (let blob = 0; blob < 3; blob++) { // three overlapping blobs read as one round canopy
      const off = new THREE.Vector3(range(-0.3, 0.3), range(-0.15, 0.25), range(-0.3, 0.3)).multiplyScalar(t.size);
      const sc = t.size * range(0.75, 1.05);
      m.compose(new THREE.Vector3(t.x, y, t.z).add(off), yaw(), new THREE.Vector3(sc, sc, sc));
      leaves.setMatrixAt(i * 3 + blob, m);
      leaves.setColorAt(i * 3 + blob, color.setHSL(range(0.2, 0.28), 0.55, range(0.28, 0.38), SRGB));
    }
  });

  // Rocks: squashed dodecahedrons in greys.
  const ROCKS = 24;
  const rocks = instanced('rocks', new THREE.DodecahedronGeometry(0.22, 0), ROCKS);
  for (let i = 0; i < ROCKS; i++) {
    const a = rand() * Math.PI * 2, r = range(1.2, RADIUS + 0.8);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, sc = range(0.5, 1.6);
    m.compose(new THREE.Vector3(x, height(x, z) + 0.05 * sc, z), yaw(), new THREE.Vector3(sc, sc * range(0.45, 0.8), sc));
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, color.setHSL(0.6, 0.05, range(0.35, 0.55), SRGB));
  }

  return forest;
};
