// Enemy drone (origin at its centre, front +Z): a lathed saucer body with a painted band, a glass
// dome, a glowing eye, two crossed arms, four rotor rings and four rotor blades named rotor_0..3
// (the game spins those about their own Y axis).
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true })); // software canvas: drawn once, uploaded once (see bitacora, fase 5)
  c.fillStyle = '#d8dde3';
  c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#c0392b';
  c.fillRect(0, 26, 256, 12);
  c.fillStyle = '#2c3e50';
  for (let x = 0; x < 256; x += 32) c.fillRect(x, 0, 3, 64); // panel seams
  const paint = new THREE.CanvasTexture(canvas);
  paint.colorSpace = THREE.SRGBColorSpace;
  paint.wrapS = THREE.RepeatWrapping;
  paint.repeat.set(2, 1);

  const hull = new THREE.MeshStandardMaterial({ name: 'hull', map: paint, metalness: 0.4, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ name: 'dark', color: 0x23272e, metalness: 0.7, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ name: 'glass', color: 0x0b1622, metalness: 0.2, roughness: 0.08 });
  const eye = new THREE.MeshBasicMaterial({ name: 'eye', color: 0xff3b2f });

  const drone = new THREE.Group();
  drone.name = 'drone';
  const add = (/** @type {string} */ name, /** @type {import('three').BufferGeometry} */ geo, /** @type {import('three').Material} */ mat, x = 0, y = 0, z = 0, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    drone.add(m);
  };
  // Saucer profile: flat underside, rounded rim, sloped top.
  const profile = [[0, -0.12], [0.3, -0.12], [0.42, -0.06], [0.45, 0], [0.42, 0.05], [0.3, 0.1], [0.18, 0.12], [0, 0.12]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add('body', new THREE.LatheGeometry(profile, 32), hull);
  add('dome', new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.11);
  add('eye', new THREE.SphereGeometry(0.07, 16, 8), eye, 0, 0, 0.43);
  add('arm_a', new THREE.BoxGeometry(1.3, 0.04, 0.08), dark, 0, 0.02, 0, 0, Math.PI / 4);
  add('arm_b', new THREE.BoxGeometry(1.3, 0.04, 0.08), dark, 0, 0.02, 0, 0, -Math.PI / 4);
  const ring = new THREE.TorusGeometry(0.17, 0.025, 8, 24);
  const blade = new THREE.BoxGeometry(0.3, 0.012, 0.045);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, x = Math.cos(a) * 0.65, z = Math.sin(a) * 0.65;
    add(`ring_${i}`, ring, dark, x, 0.04, z, Math.PI / 2);
    add(`rotor_${i}`, blade, dark, x, 0.06, z);
  }
  return drone;
};
