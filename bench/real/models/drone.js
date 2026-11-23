// @ts-check
// Code imitation of Kenney's "enemy-flying" (Starter-Kit-FPS, CC0): a rounded cube robot (red belly, dark head)
// with a yellow face plate and an angry face, a red-tipped antenna and two blasters on side mounts.
// Same parts, names and pivots as the original: root › torso › antenna, root › blaster-left / blaster-right.
import { circle, shape } from './kit.js';

/** @typedef {[number, number, number]} V3 */

const torsoColour = (/** @type {number} */ y, /** @type {string} */ side) =>
  side === 'top' ? 0x45454f : side === 'bottom' ? 0xd3363d
    : y < 0.029 ? 0xd5383d : y < 0.1 ? 0xdb3f3d : y < 0.3 ? 0xed563e : y < 0.5 ? 0x3b3b41 : y < 0.571 ? 0x42424b : 0x44444e;
const knobColour = (/** @type {number} */ y, /** @type {string} */ side) =>
  side === 'top' ? 0xfa673f : side === 'bottom' ? 0xd3363d
    : y < 0.09 ? 0xd5383d : y < 0.125 ? 0xda3e3d : y < 0.225 ? 0xe74f3e : y < 0.26 ? 0xf45f3f : 0xf9663f;
const DARK = 0x3d3d44;

// Blaster profile in the xy plane (counter-clockwise), extruded along z: flat against the mount, rounded outside.
const GUN = /** @type {[number, number][]} */ ([[0.05, -0.1], [0.2, -0.1], [0.235, -0.085], [0.25, -0.05], [0.25, 0.05], [0.235, 0.085], [0.2, 0.1], [0.05, 0.1]]);
const MUZZLE = /** @type {[number, number][]} */ ([[0.1, -0.05], [0.19, -0.05], [0.2, -0.04], [0.2, 0.04], [0.19, 0.05], [0.1, 0.05]]);
const gunColour = (/** @type {number} */ y) => (y > 0.095 ? 0x81869c : y > 0.06 ? 0x7c8197 : y > -0.06 ? 0x71768d : y > -0.095 ? 0x5f657d : 0x5a6078);

/** The left blaster (+x side); the right one is its mirror image. @param {typeof import('three')} THREE @param {1 | -1} s */
function blaster(THREE, s) {
  const m = (/** @type {V3} */ [x, y, z]) => /** @type {V3} */ ([s * x, y, z]);
  // Mount: a regular octagon (r 0.2) in the yz plane, 5 cm thick — a loft along +x (local y → x).
  const g = shape(THREE).at(([x, y, z]) => m([y, -x, z]), s < 0).loft(
    [{ y: 0, pts: circle(0.2, 8) }, { y: 0.05, pts: circle(0.2, 8) }],
    (_y, side, c) => (side === 'top' ? 0xa2a9cb : side === 'bottom' ? 0x7d829c : -c[0] > 0.12 ? 0xb4bce2 : -c[0] > -0.01 ? 0x9ba3c3 : 0x7d829c),
  );
  // Body and muzzle: lofts along -z (local y → -z, local z → y), so profile points are (x, y).
  g.at(([x, y, z]) => m([x, z, -y]), s < 0)
    .loft([{ y: -0.359, pts: GUN }, { y: 0.241, pts: GUN }], (_y, side, c) => (side === 'side' ? gunColour(c[2]) : 0x6b7088))
    .loft([{ y: -0.459, pts: MUZZLE }, { y: -0.359, pts: MUZZLE }], (_y, side, c) => (side === 'bottom' ? 0x3d3d43 : gunColour(c[2] * 2)));
  // Fin along the outer side and the two-pronged sight on top.
  g.at(m, s < 0)
    .box({ hx: 0.025, hy: 0.025, hz: 0.25, r: 0, cx: 0.275, cy: 0, cz: 0.059 }, () => 0x6a7087)
    .box({ hx: 0.0205, hy: 0.027, hz: 0.034, r: 0, cx: 0.1105, cy: 0.127, cz: 0.325 }, (_y, side) => (side === 'top' ? 0x7b8096 : 0x6d738a))
    .box({ hx: 0.0205, hy: 0.027, hz: 0.034, r: 0, cx: 0.1795, cy: 0.127, cz: 0.325 }, (_y, side) => (side === 'top' ? 0x7b8096 : 0x6d738a));
  return g.build(50);
}

/** Octagon: square of half size h + c with corners cut by c (xz plane). */
const octagon = (/** @type {number} */ h, /** @type {number} */ c) =>
  /** @type {[number, number][]} */ ([[h + c, h], [h, h + c], [-h, h + c], [-h - c, h], [-h - c, -h], [-h, -h - c], [h, -h - c], [h + c, -h]]);

/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const material = new THREE.MeshStandardMaterial({ name: 'colormap', vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const part = (/** @type {string} */ name, /** @type {THREE.BufferGeometry} */ geo, /** @type {V3} */ at) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.position.set(...at);
    return mesh;
  };

  // Torso: rounded cube (core 0.4 m, radius 0.1 in 2 steps), red below 0.3 m, dark above; yellow face plate
  // (a loft along +z: local y → z) with the angry face drawn as flat dark plates just in front of it.
  const torso = shape(THREE).box({ hx: 0.2, hy: 0.2, hz: 0.2, r: 0.1, segs: 2, cy: 0.3, cuts: [0.3] }, torsoColour)
    .at(([x, y, z]) => [x, 0.3 - z, y])
    .loft([{ y: 0.3, pts: octagon(0.195, 0.025) }, { y: 0.325, pts: octagon(0.178, 0.022) }],
      (_y, _side, c) => (0.3 - c[2] > 0.3 ? 0xffcb5d : 0xffb64b), { caps: false })
    .at((p) => p)
    .plate([[-0.178, 0.1], [0.178, 0.1], [0.2, 0.122], [0.2, 0.3], [-0.2, 0.3], [-0.2, 0.122]], 0.325, 0xffb84d) // plate front: orange below,
    .plate([[-0.2, 0.3], [0.2, 0.3], [0.2, 0.478], [0.178, 0.5], [-0.178, 0.5], [-0.2, 0.478]], 0.325, 0xffca5c); // yellow above
  const face = /** @type {[number, number][][]} */ ([
    [[-0.17, 0.383], [-0.04, 0.345], [-0.04, 0.37], [-0.17, 0.408]], // brows, slanting down to the middle
    [[0.04, 0.345], [0.17, 0.383], [0.17, 0.408], [0.04, 0.37]],
    [[-0.143, 0.305], [-0.068, 0.305], [-0.068, 0.338], [-0.143, 0.36]], // eyes
    [[0.068, 0.305], [0.142, 0.305], [0.142, 0.36], [0.068, 0.338]],
    [[-0.098, 0.222], [0.085, 0.211], [0.098, 0.25], [-0.09, 0.259]], // smirk
  ]);
  for (const pts of face) torso.plate(pts, 0.335, DARK);

  // Antenna: tapered stem + rounded red knob.
  const antenna = shape(THREE)
    .loft([{ y: -0.05, pts: octagon(0.028, 0) }, { y: 0.098, pts: octagon(0.037, 0) }], (_y, side) => (side === 'top' ? 0x45454f : DARK))
    .box({ hx: 0.05, hy: 0.05, hz: 0.05, r: 0.05, segs: 2, cy: 0.175 }, knobColour);

  const root = new THREE.Group();
  root.name = 'root';
  root.position.set(0, 0.02375, 0);
  const torsoMesh = part('torso', torso.build(50), [0, -0.02375, -0.02375]);
  torsoMesh.add(part('antenna', antenna.build(50), [0, 0.6, 0]));
  root.add(torsoMesh, part('blaster-left', blaster(THREE, 1), [0.3, 0.3, -0.02375]), part('blaster-right', blaster(THREE, -1), [-0.3, 0.3, -0.02375]));
  return root;
};
