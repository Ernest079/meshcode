// Modular dungeon kit — techniques: tiling canvas textures (bricks, flagstones), a doorway made with
// an ExtrudeGeometry Shape that has an arched HOLE, and pieces sized to snap on a 2 m grid.
// Each piece is a named child group: pull out `wall`, `arch`, … and place them in your level.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const GRID = 2, WALL_H = 2.5, WALL_T = 0.4;
  let seed = 5;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  /** 1 texture tile = 1 metre. @param {(c: CanvasRenderingContext2D) => void} draw */
  const tiling = (draw) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };
  // Rescale UVs so one texture tile = 1 metre on every face, whatever the piece size.
  const metres = (/** @type {THREE.BufferGeometry & { parameters: any }} */ geo) => {
    const uv = geo.attributes.uv, p = geo.parameters;
    // BoxGeometry face order: ±x, ±y, ±z (4 vertices each); cylinders: around × height.
    const dims = geo.type === 'BoxGeometry'
      ? [[p.depth, p.height], [p.depth, p.height], [p.width, p.depth], [p.width, p.depth], [p.width, p.height], [p.width, p.height]]
      : [[2 * Math.PI * p.radiusBottom, p.height]];
    const per = uv.count / dims.length;
    for (let i = 0; i < uv.count; i++) {
      const [su, sv] = dims[Math.min(Math.floor(i / per), dims.length - 1)];
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    return geo;
  };
  const shade = (/** @type {number} */ base) => {
    const v = Math.round(base + (rand() - 0.5) * 26);
    return `rgb(${v},${v - 4},${v - 10})`;
  };
  const speckle = (/** @type {CanvasRenderingContext2D} */ c) => {
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(0,0,0,${rand() * 0.18})`;
      c.fillRect(rand() * 256, rand() * 256, 2, 2);
    }
  };
  const bricks = tiling((c) => {
    c.fillStyle = '#2b2622'; // mortar
    c.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 4; col++) {
        c.fillStyle = shade(92);
        c.fillRect(col * 64 + (row % 2) * 32 + 3, row * 32 + 3, 58, 26);
      }
    }
    speckle(c);
  });
  const flagstones = tiling((c) => {
    c.fillStyle = '#24211e';
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) {
      let x = 0;
      while (x < 256) { // stones of random width per row
        const w = Math.min(48 + Math.floor(rand() * 48), 256 - x);
        c.fillStyle = shade(74);
        c.fillRect(x + 3, y + 3, w - 6, 58);
        x += w;
      }
    }
    speckle(c);
  });

  const stone = new THREE.MeshStandardMaterial({ name: 'bricks', map: bricks, roughness: 0.95 });
  const floorMat = new THREE.MeshStandardMaterial({ name: 'flagstones', map: flagstones, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ name: 'carved_stone', color: 0x6f675c, roughness: 0.85 });

  const kit = new THREE.Group();
  kit.name = 'dungeon_kit';
  /** A piece is a named group; pieces are laid out side by side for the preview. */
  const piece = (/** @type {string} */ name, /** @type {number} */ slot) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.x = (slot - 2) * (GRID + 0.8);
    kit.add(g);
    return g;
  };
  const mesh = (/** @type {THREE.Group} */ g, /** @type {string} */ name, /** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.position.y = y;
    g.add(m);
    return m;
  };

  // 1. Floor tile, 2×2 m.
  mesh(piece('floor', 0), 'floor_tile', metres(new THREE.BoxGeometry(GRID, 0.1, GRID)), floorMat, 0.05);

  // 2. Straight wall, 2 m long.
  mesh(piece('wall', 1), 'wall_segment', metres(new THREE.BoxGeometry(GRID, WALL_H, WALL_T)), stone, WALL_H / 2);

  // 3. Octagonal column with base and capital.
  const column = piece('column', 2);
  mesh(column, 'base', new THREE.BoxGeometry(0.75, 0.2, 0.75), trim, 0.1);
  mesh(column, 'shaft', metres(new THREE.CylinderGeometry(0.26, 0.3, WALL_H - 0.4, 8)), stone, WALL_H / 2);
  mesh(column, 'capital', new THREE.BoxGeometry(0.7, 0.2, 0.7), trim, WALL_H - 0.1);

  // 4. Doorway: wall outline with an arched hole, extruded to wall thickness.
  const outline = new THREE.Shape().moveTo(-GRID / 2, 0).lineTo(GRID / 2, 0).lineTo(GRID / 2, WALL_H).lineTo(-GRID / 2, WALL_H).closePath();
  const door = new THREE.Path().moveTo(-0.5, 0.0001).lineTo(0.5, 0.0001).lineTo(0.5, 1.45).absarc(0, 1.45, 0.5, 0, Math.PI, false).closePath();
  outline.holes.push(door);
  const archGeo = new THREE.ExtrudeGeometry(outline, { depth: WALL_T, bevelEnabled: false, curveSegments: 16 });
  archGeo.translate(0, 0, -WALL_T / 2); // centred on the wall line, like the straight wall
  const arch = piece('arch', 3);
  mesh(arch, 'doorway', archGeo, stone);
  mesh(arch, 'keystone', new THREE.BoxGeometry(0.22, 0.3, WALL_T + 0.06), trim, 2.02);

  // 5. Stairs: five steps rising 1 m over 2 m.
  const stairs = piece('stairs', 4);
  for (let i = 0; i < 5; i++) {
    const h = 0.2 * (i + 1);
    const step = mesh(stairs, `step_${i + 1}`, metres(new THREE.BoxGeometry(GRID, h, GRID / 5)), stone, h / 2);
    step.position.z = GRID / 2 - (GRID / 5) * (i + 0.5);
  }

  return kit;
};
