// Benchmark arena (static environment): riveted steel floor plates, concrete walls with a hazard
// stripe, and steel pillars. Textures are drawn on canvases with per-pixel grain, so the code variant
// pays real generation work at load; the files variants get the same pixels as PNG/WebP in the GLB.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const SIZE = 40, WALL_H = 4, WALL_T = 0.6;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  /** Canvas texture helper: draw, add per-pixel grain, wrap as an sRGB repeating texture. */
  const texture = (/** @type {number} */ w, /** @type {number} */ h, /** @type {(c: CanvasRenderingContext2D) => void} */ draw, /** @type {number} */ grain, /** @type {number} */ rx, /** @type {number} */ ry) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    draw(c);
    const img = c.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * grain;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
  };

  // Floor: 4×4 plates per tile (each tile covers 8 m), seams, rivets in the corners, rust stains.
  const floorMap = texture(1024, 1024, (c) => {
    c.fillStyle = '#5d6168';
    c.fillRect(0, 0, 1024, 1024);
    for (let py = 0; py < 4; py++) {
      for (let px = 0; px < 4; px++) {
        const x = px * 256, y = py * 256, shade = 88 + Math.floor(rand() * 22);
        c.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
        c.fillRect(x + 3, y + 3, 250, 250);
        c.strokeStyle = 'rgba(255,255,255,0.12)'; // diamond tread
        c.lineWidth = 2;
        for (let k = 0; k < 250; k += 18) {
          c.beginPath(); c.moveTo(x + 3 + k, y + 3); c.lineTo(x + 3, y + 3 + k); c.stroke();
        }
        c.fillStyle = '#2b2d31';
        for (const [rx, ry] of [[14, 14], [242, 14], [14, 242], [242, 242]]) {
          c.beginPath(); c.arc(x + rx, y + ry, 6, 0, Math.PI * 2); c.fill();
        }
        if (rand() < 0.45) {
          const g = c.createRadialGradient(x + 60 + rand() * 136, y + 60 + rand() * 136, 4, x + 128, y + 128, 120);
          g.addColorStop(0, 'rgba(120,62,24,0.55)');
          g.addColorStop(1, 'rgba(120,62,24,0)');
          c.fillStyle = g;
          c.fillRect(x, y, 256, 256);
        }
      }
    }
  }, 26, SIZE / 8, SIZE / 8);

  // Walls: concrete panels, seams, water stains, and a hazard stripe along the bottom.
  const wallMap = texture(1024, 512, (c) => {
    c.fillStyle = '#8b8a86';
    c.fillRect(0, 0, 1024, 512);
    for (let k = 0; k < 4; k++) {
      c.fillStyle = `rgba(${rand() < 0.5 ? '60,58,54' : '170,168,160'},0.18)`;
      c.fillRect(k * 256 + 4, 0, 248, 448);
    }
    c.fillStyle = '#4a4946';
    for (let k = 0; k <= 4; k++) c.fillRect(k * 256 - 3, 0, 6, 448);
    for (let k = 0; k < 14; k++) {
      const x = rand() * 1024, g = c.createLinearGradient(0, 40, 0, 420);
      g.addColorStop(0, 'rgba(50,48,44,0.35)');
      g.addColorStop(1, 'rgba(50,48,44,0)');
      c.fillStyle = g;
      c.fillRect(x, 40, 8 + rand() * 30, 380);
    }
    c.fillStyle = '#e8b400';
    c.fillRect(0, 448, 1024, 64);
    c.fillStyle = '#1d1d1f';
    for (let x = -64; x < 1024; x += 64) {
      c.beginPath(); c.moveTo(x, 512); c.lineTo(x + 32, 448); c.lineTo(x + 64, 448); c.lineTo(x + 32, 512); c.fill();
    }
  }, 18, SIZE / 4, 1);

  const arena = new THREE.Group();
  arena.name = 'arena';

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ name: 'floor', map: floorMap, roughness: 0.7, metalness: 0.35 }));
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  arena.add(floor);

  const concrete = new THREE.MeshStandardMaterial({ name: 'concrete', map: wallMap, roughness: 0.9 });
  for (const [i, [x, z, ry]] of /** @type {[number, number, number][]} */ ([[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]).entries()) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 2 * WALL_T, WALL_H, WALL_T), concrete);
    wall.name = `wall_${i}`;
    wall.position.set(x * (SIZE / 2 + WALL_T / 2), WALL_H / 2, z * (SIZE / 2 + WALL_T / 2));
    wall.rotation.y = ry;
    arena.add(wall);
  }

  // Pillars along the walls, each with a lamp ring near the top.
  const steel = new THREE.MeshStandardMaterial({ name: 'pillar', color: 0x3c4047, metalness: 0.8, roughness: 0.45 });
  const lamp = new THREE.MeshBasicMaterial({ name: 'lamp', color: 0x9fe8ff });
  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.6, 6, 20);
  const ringGeo = new THREE.TorusGeometry(0.62, 0.06, 8, 32);
  let n = 0;
  for (const s of [-1, 1]) {
    for (const t of [-0.5, 0, 0.5]) {
      for (const [x, z] of [[s * (SIZE / 2 - 0.7), t * SIZE], [t * SIZE, s * (SIZE / 2 - 0.7)]]) {
        const pillar = new THREE.Mesh(pillarGeo, steel);
        pillar.name = `pillar_${n}`;
        pillar.position.set(x, 3, z);
        const ring = new THREE.Mesh(ringGeo, lamp);
        ring.name = `lamp_${n++}`;
        ring.position.set(x, 5.2, z);
        ring.rotation.x = Math.PI / 2;
        arena.add(pillar, ring);
      }
    }
  }
  return arena;
};
