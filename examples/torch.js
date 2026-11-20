// Wall torch — techniques: LatheGeometry profiles, TorusGeometry rings, canvas textures,
// layered unlit flame, a PointLight, and InstancedMesh embers. Units: metres, Y up.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  // Deterministic randomness (same model on every run).
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  /** Canvas texture helper. @param {number} w @param {number} h @param {(c: CanvasRenderingContext2D) => void} draw */
  const canvasTexture = (w, h, draw) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const wood = canvasTexture(64, 256, (c) => {
    c.fillStyle = '#6b4226';
    c.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 40; i++) { // grain streaks along the handle
      c.strokeStyle = `rgba(${rand() < 0.5 ? '40,22,10' : '150,100,60'},${0.25 + rand() * 0.3})`;
      c.lineWidth = 1 + rand() * 2;
      const x = rand() * 64;
      c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 6, 80, x - 6, 170, x + 3, 256); c.stroke();
    }
  });
  const cloth = canvasTexture(128, 64, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 64); // charred on top, linen below
    g.addColorStop(0, '#1d1410'); g.addColorStop(0.35, '#5a4632'); g.addColorStop(1, '#a88c62');
    c.fillStyle = g; c.fillRect(0, 0, 128, 64);
    c.strokeStyle = 'rgba(30,20,12,0.55)'; c.lineWidth = 3;
    for (let x = -64; x < 128; x += 14) { c.beginPath(); c.moveTo(x, 64); c.lineTo(x + 64, 0); c.stroke(); } // wrapping
  });

  const iron = new THREE.MeshStandardMaterial({ name: 'iron', color: 0x2b2d31, metalness: 0.85, roughness: 0.45 });
  const handleMat = new THREE.MeshStandardMaterial({ name: 'wood', map: wood, roughness: 0.85 });
  const clothMat = new THREE.MeshStandardMaterial({ name: 'cloth', map: cloth, roughness: 1 });
  // Fire emits its own light, so it is unlit (glTF: KHR_materials_unlit).
  const flameMat = (/** @type {number} */ color, /** @type {number} */ opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

  const torch = new THREE.Group();
  torch.name = 'torch';

  // Wall plate with four rivets.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.025), iron);
  plate.name = 'wall_plate';
  plate.position.set(0, 0, -0.0125);
  torch.add(plate);
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012, 8, 6), iron, 4);
  rivets.name = 'rivets';
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, y], i) =>
    rivets.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x * 0.055, y * 0.14, 0.003)));
  torch.add(rivets);

  // Arm out of the wall, holding two rings.
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), iron);
  arm.name = 'arm';
  arm.position.set(0, -0.02, 0.08);
  torch.add(arm);
  for (const [y, r] of [[-0.02, 0.05], [0.1, 0.058]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 24), iron);
    ring.name = 'ring';
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, y, 0.19);
    torch.add(ring);
  }

  // The torch itself leans out of the rings.
  const stick = new THREE.Group();
  stick.name = 'stick';
  stick.position.set(0, 0.02, 0.19);
  stick.rotation.x = 0.22;
  torch.add(stick);

  // Turned handle: radius profile (x) along height (y), revolved by LatheGeometry.
  const profile = [[0, -0.42], [0.022, -0.42], [0.03, -0.4], [0.024, -0.37], [0.03, -0.1], [0.036, 0.1], [0.034, 0.16], [0, 0.16]];
  const handle = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 12), handleMat);
  handle.name = 'handle';
  stick.add(handle);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.048, 0.15, 14), clothMat);
  head.name = 'cloth_head';
  head.position.y = 0.21;
  stick.add(head);
  for (const y of [0.16, 0.25]) {
    const rope = new THREE.Mesh(new THREE.TorusGeometry(y < 0.2 ? 0.051 : 0.06, 0.006, 6, 20), clothMat);
    rope.name = 'rope';
    rope.rotation.x = Math.PI / 2;
    rope.position.y = y;
    stick.add(rope);
  }

  // Flame: three nested teardrops (outer orange → inner white), each a lathed profile.
  const tear = (/** @type {number} */ w, /** @type {number} */ h) =>
    new THREE.LatheGeometry(Array.from({ length: 9 }, (_, i) => {
      const t = i / 8; // 0 = base, 1 = tip
      return new THREE.Vector2(w * Math.sin(Math.PI * t) * (1 - t * 0.55), h * t);
    }), 14);
  const flame = new THREE.Group();
  flame.name = 'flame';
  flame.position.y = 0.27;
  stick.add(flame);
  [[0.075, 0.3, 0xff4d00, 0.6], [0.055, 0.22, 0xff9d00, 0.8], [0.032, 0.13, 0xfff4c2, 1]].forEach(([w, h, color, opacity], i) => {
    const layer = new THREE.Mesh(tear(w, h), flameMat(color, opacity));
    layer.name = `flame_${['outer', 'middle', 'core'][i]}`;
    layer.rotation.y = i * 0.7; // break the symmetry a little
    flame.add(layer);
  });
  const light = new THREE.PointLight(0xff9a40, 3, 4, 2);
  light.name = 'torch_light';
  light.position.y = 0.12;
  flame.add(light);

  // Embers drifting up from the flame.
  const embers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.006, 0), flameMat(0xff7a1a, 1), 14);
  embers.name = 'embers';
  const m = new THREE.Matrix4();
  for (let i = 0; i < embers.count; i++) {
    const a = rand() * Math.PI * 2, r = 0.02 + rand() * 0.06;
    embers.setMatrixAt(i, m.makeTranslation(Math.cos(a) * r, 0.18 + rand() * 0.25, Math.sin(a) * r));
  }
  flame.add(embers);

  return torch;
};
