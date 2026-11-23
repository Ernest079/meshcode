// Treasure chest — techniques: partial cylinders (thetaLength) for a curved lid, a hinge pivot
// animated from code (`animate` rotates `lid_hinge` around X, baked into the GLB), torus arcs as
// metal bands, and an InstancedMesh coin pile with per-instance rotation. Units: metres, Y up, front faces +Z.

// The lid closes and opens again every 3 s; t = 0 (the rest pose) is fully open.
export const duration = 3;
/** @param {import('three').Object3D} root @param {number} t */
export const animate = (root, t) => {
  /** @type {import('three').Object3D} */ (root.getObjectByName('lid_hinge')).rotation.x = -1.1 * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / duration));
};

/** @param {typeof import('three')} THREE */
export default (THREE) => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  const W = 0.9, D = 0.55, H = 0.42; // body width, depth, height
  const R = D / 2; // lid radius: a half cylinder as deep as the body

  // Plank texture: horizontal boards with dark seams and grain.
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  for (let i = 0; i < 4; i++) {
    c.fillStyle = ['#7a4b2a', '#6e4224', '#82512e', '#734626'][i];
    c.fillRect(0, i * 32, 256, 32);
    c.fillStyle = 'rgba(30,15,5,0.8)';
    c.fillRect(0, i * 32, 256, 2); // seam between boards
    for (let k = 0; k < 6; k++) {
      c.fillStyle = `rgba(40,20,8,${0.15 + rand() * 0.2})`;
      c.fillRect(0, i * 32 + 4 + rand() * 26, 256, 1);
    }
  }
  const planks = new THREE.CanvasTexture(canvas);
  planks.colorSpace = THREE.SRGBColorSpace;

  const wood = new THREE.MeshStandardMaterial({ name: 'planks', map: planks, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ name: 'iron', color: 0x3a3c42, metalness: 0.9, roughness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ name: 'gold', color: 0xf2c14e, metalness: 1, roughness: 0.25 });

  const chest = new THREE.Group();
  chest.name = 'chest';

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wood);
  body.name = 'body';
  body.position.y = H / 2;
  chest.add(body);

  // Iron: corner posts, a rim along the top, and three vertical straps.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, H + 0.01, 0.05), iron);
    post.name = 'corner';
    post.position.set(sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02));
    chest.add(post);
  }
  for (const [w, d, x, z] of [[W + 0.02, 0.04, 0, D / 2], [W + 0.02, 0.04, 0, -D / 2], [0.04, D, W / 2, 0], [0.04, D, -W / 2, 0]]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), iron); // frame around the opening
    rim.name = 'rim';
    rim.position.set(x, H - 0.0175, z);
    chest.add(rim);
  }
  for (const x of [-0.28, 0.28]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, D + 0.02), iron);
    strap.name = 'strap';
    strap.position.set(x, H / 2, 0);
    chest.add(strap);
  }

  // Lid on a hinge along the back edge. Opening the chest = rotating lid_hinge.rotation.x negative.
  const hinge = new THREE.Group();
  hinge.name = 'lid_hinge';
  hinge.position.set(0, H, -D / 2);
  hinge.rotation.x = -1.1; // shown open
  chest.add(hinge);

  // Half cylinder lying along X: thetaLength = PI keeps only the upper half.
  const lidShape = new THREE.CylinderGeometry(R, R, W, 24, 1, false, 0, Math.PI);
  lidShape.rotateZ(Math.PI / 2);
  const lid = new THREE.Mesh(lidShape, wood);
  lid.name = 'lid';
  lid.position.set(0, 0, R); // centre of the arc sits above the body's centre line
  hinge.add(lid);
  const lidBase = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02, D), wood); // closes the lid's underside
  lidBase.name = 'lid_base';
  lidBase.position.set(0, 0.01, R);
  hinge.add(lidBase);
  for (const x of [-0.28, 0.28, 0]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.006, 0.014, 6, 24, Math.PI), x ? iron : gold);
    band.name = x ? 'lid_band' : 'lid_trim';
    band.rotation.y = Math.PI / 2;
    band.position.set(x, 0, R);
    hinge.add(band);
  }

  // Lock plate and a gold keyhole ring on the front.
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.03), iron);
  lock.name = 'lock';
  lock.position.set(0, H - 0.08, D / 2 + 0.01);
  chest.add(lock);
  const keyhole = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 16), gold);
  keyhole.name = 'keyhole';
  keyhole.position.set(0, H - 0.08, D / 2 + 0.028);
  chest.add(keyhole);

  // Coins heaped inside: a dome of jittered positions, each coin tilted randomly.
  const COINS = 90;
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.007, 14), gold, COINS);
  coins.name = 'coins';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < COINS; i++) {
    const x = (rand() - 0.5) * (W - 0.12), z = (rand() - 0.5) * (D - 0.12);
    const dome = 0.09 * (1 - (x / (W / 2)) ** 2) * (1 - (z / (D / 2)) ** 2);
    q.setFromEuler(e.set((rand() - 0.5) * 1.2, rand() * Math.PI, (rand() - 0.5) * 1.2));
    m.compose(new THREE.Vector3(x, H + dome * rand(), z), q, new THREE.Vector3(1, 1, 1));
    coins.setMatrixAt(i, m);
  }
  chest.add(coins);

  return chest;
};
