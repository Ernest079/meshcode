// Barrel — techniques: a bulging LatheGeometry driven by one math function, hoops that follow
// that same function, a stave texture that wraps around (RepeatWrapping), and a tap on the front.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const HEIGHT = 0.9, BELLY = 0.36, ENDS = 0.29, STAVES = 16;
  // Radius at height y (−H/2..H/2): widest in the middle, narrower at both ends.
  const radius = (/** @type {number} */ y) => ENDS + (BELLY - ENDS) * Math.cos((Math.PI * y) / HEIGHT);

  // One stave per texture tile: lighter board, dark gap on its right edge, grain lines.
  const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 256 });
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  c.fillStyle = '#8a5a33';
  c.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 18; i++) {
    c.fillStyle = `rgba(${rand() < 0.5 ? '50,28,12' : '170,120,75'},${0.2 + rand() * 0.25})`;
    c.fillRect(rand() * 60, 0, 1 + rand() * 2, 256);
  }
  c.fillStyle = '#2a170a';
  c.fillRect(60, 0, 4, 256);
  const staves = new THREE.CanvasTexture(canvas);
  staves.colorSpace = THREE.SRGBColorSpace;
  staves.wrapS = THREE.RepeatWrapping;
  staves.repeat.set(STAVES, 1);

  const wood = new THREE.MeshStandardMaterial({ name: 'staves', map: staves, roughness: 0.75 });
  const lidWood = new THREE.MeshStandardMaterial({ name: 'lid', color: 0x7a4c2a, roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ name: 'iron', color: 0x34363b, metalness: 0.85, roughness: 0.4 });
  const brass = new THREE.MeshStandardMaterial({ name: 'brass', color: 0xc9a24b, metalness: 1, roughness: 0.3 });

  const barrel = new THREE.Group();
  barrel.name = 'barrel';

  // Body: 24 profile points revolved around Y; the lathe UVs make the texture wrap around.
  const profile = Array.from({ length: 24 }, (_, i) => {
    const y = -HEIGHT / 2 + (HEIGHT * i) / 23;
    return new THREE.Vector2(radius(y), y + HEIGHT / 2);
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), wood);
  body.name = 'body';
  barrel.add(body);

  // Lids sit slightly inside the rim (the chime), as on real barrels.
  for (const y of [0.025, HEIGHT - 0.025]) {
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(ENDS - 0.012, ENDS - 0.012, 0.02, 40), lidWood);
    lid.name = 'lid';
    lid.position.y = y;
    barrel.add(lid);
  }

  // Four hoops whose radius follows the bulge exactly.
  for (const y of [-0.4, -0.22, 0.22, 0.4]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius(y * HEIGHT) + 0.004, 0.012, 6, 48), iron);
    hoop.name = 'hoop';
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y * HEIGHT + HEIGHT / 2;
    barrel.add(hoop);
  }

  // Brass tap near the bottom, pointing out along +Z.
  const tap = new THREE.Group();
  tap.name = 'tap';
  tap.position.set(0, 0.2, radius(0.2 - HEIGHT / 2));
  barrel.add(tap);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 12), brass);
  spout.name = 'spout';
  spout.rotation.x = Math.PI / 2;
  spout.position.z = 0.05;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.05, 12), brass);
  nozzle.name = 'nozzle';
  nozzle.position.set(0, -0.03, 0.1);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.015), brass);
  handle.name = 'valve';
  handle.position.set(0, 0.03, 0.07);
  tap.add(spout, nozzle, handle);

  return barrel;
};
