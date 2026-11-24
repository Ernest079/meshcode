// Barrel: a bulging LatheGeometry driven by one function, hoops that follow it, a stave texture
// that wraps around. Origin on the floor. (The examples/barrel.js design, without the tap.)
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const HEIGHT = 0.9, BELLY = 0.36, ENDS = 0.29, STAVES = 16;
  const radius = (/** @type {number} */ y) => ENDS + (BELLY - ENDS) * Math.cos((Math.PI * y) / HEIGHT);

  const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 256 });
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true })); // software canvas: drawn once, uploaded once (see bitacora, fase 5)
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

  const barrel = new THREE.Group();
  barrel.name = 'barrel';
  const profile = Array.from({ length: 24 }, (_, i) => {
    const y = -HEIGHT / 2 + (HEIGHT * i) / 23;
    return new THREE.Vector2(radius(y), y + HEIGHT / 2);
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), wood);
  body.name = 'body';
  barrel.add(body);
  for (const [i, y] of [0.025, HEIGHT - 0.025].entries()) {
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(ENDS - 0.012, ENDS - 0.012, 0.02, 40), lidWood);
    lid.name = `lid_${i}`;
    lid.position.y = y;
    barrel.add(lid);
  }
  for (const [i, y] of [-0.4, -0.22, 0.22, 0.4].entries()) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius(y * HEIGHT) + 0.004, 0.012, 6, 48), iron);
    hoop.name = `hoop_${i}`;
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y * HEIGHT + HEIGHT / 2;
    barrel.add(hoop);
  }
  return barrel;
};
