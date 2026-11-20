// Spaceship (forward = −Z) — techniques: a lathed fuselage turned on its side, swept wings
// extruded from a 2D Shape and mirrored, a half-sphere canopy, unlit engine glow, and a
// small `part()` helper to keep a 20-piece model readable. Starter ship for the arena shooter.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const hull = new THREE.MeshStandardMaterial({ name: 'hull', color: 0xdfe3e8, metalness: 0.35, roughness: 0.45 });
  const paint = new THREE.MeshStandardMaterial({ name: 'paint', color: 0xd9483b, metalness: 0.2, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ name: 'dark_metal', color: 0x2a2d33, metalness: 0.8, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ name: 'canopy', color: 0x1b3a5c, metalness: 0.9, roughness: 0.08 });
  const glow = new THREE.MeshBasicMaterial({ name: 'engine_glow', color: 0x6fe8ff });

  const ship = new THREE.Group();
  ship.name = 'spaceship';

  /** Add a named mesh at a position (and optional rotation) to a parent. */
  const part = (/** @type {string} */ name, /** @type {THREE.BufferGeometry} */ geo, /** @type {THREE.Material} */ mat,
    /** @type {number[]} */ [x, y, z], /** @type {number[]} */ [rx, ry, rz] = [0, 0, 0], parent = ship) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  };

  // Fuselage: radius profile from tail (t=0) to nose (t=1), revolved, then laid along −Z.
  const L = 2.6;
  const profile = Array.from({ length: 20 }, (_, i) => {
    const t = i / 19;
    const r = t < 0.7 ? 0.24 + 0.1 * Math.sin((t / 0.7) * Math.PI * 0.5) : 0.34 * Math.cos(((t - 0.7) / 0.3) * Math.PI * 0.5);
    return new THREE.Vector2(Math.max(r, 0.001), t * L);
  });
  const body = new THREE.LatheGeometry(profile, 24);
  body.rotateX(-Math.PI / 2); // +Y (nose) → −Z
  body.scale(1, 0.72, 1); // flatter than round
  part('fuselage', body, hull, [0, 0, 1.2]);
  part('nose_stripe', new THREE.CylinderGeometry(0.3, 0.33, 0.12, 24), paint, [0, 0, -0.55], [Math.PI / 2, 0, 0]).scale.set(1, 1, 0.72);

  // Canopy: upper half of a sphere, stretched along Z.
  part('canopy', new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0, 0.14, -0.55]).scale.set(1, 0.8, 2.3);

  // Swept wing drawn in 2D (x = span, y = toward the tail), extruded, laid flat. Left = mirrored points.
  const wing = (/** @type {number} */ side) => {
    const pts = [[0.2, -0.35], [1.35, 0.35], [1.5, 0.7], [1.45, 0.82], [0.2, 0.75]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * side, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
    geo.rotateX(Math.PI / 2); // shape plane → XZ, thickness → −Y
    return geo;
  };
  for (const side of [1, -1]) {
    const label = side > 0 ? 'right' : 'left';
    part(`wing_${label}`, wing(side), hull, [0, 0.02, 0.15]);
    part(`wing_stripe_${label}`, new THREE.BoxGeometry(0.12, 0.075, 0.55), paint, [side * 1.2, 0, 0.75], [0, side * 0.35, 0]);
    part(`cannon_${label}`, new THREE.CylinderGeometry(0.025, 0.03, 0.9, 10), dark, [side * 1.42, 0, 0.35], [Math.PI / 2, 0, 0]);
    part(`cannon_tip_${label}`, new THREE.CylinderGeometry(0.035, 0.035, 0.06, 10), paint, [side * 1.42, 0, -0.1], [Math.PI / 2, 0, 0]);

    // Engine nacelle with a glowing nozzle and a hot inner ring.
    const engine = new THREE.Group();
    engine.name = `engine_${label}`;
    engine.position.set(side * 0.42, -0.02, 1.05);
    ship.add(engine);
    part('nacelle', new THREE.CylinderGeometry(0.13, 0.16, 0.8, 18), dark, [0, 0, 0], [Math.PI / 2, 0, 0], engine);
    part('intake', new THREE.TorusGeometry(0.13, 0.025, 8, 18), paint, [0, 0, -0.4], [0, 0, 0], engine);
    part('nozzle', new THREE.CylinderGeometry(0.16, 0.12, 0.12, 18, 1, true), dark, [0, 0, 0.46], [Math.PI / 2, 0, 0], engine);
    part('glow', new THREE.CircleGeometry(0.115, 18), glow, [0, 0, 0.5], [0, 0, 0], engine);

    // Tail fins, canted outward.
    const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.62, 0.42), new THREE.Vector2(0.38, 0.42)]);
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.03, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2); // shape x → +Z (toward the tail), stands upright
    part(`fin_${label}`, finGeo, paint, [side * 0.22, 0.12, 0.6], [0, 0, -side * 0.35]);
  }

  return ship;
};
