// @ts-check
// Code imitation of KayKit Space Base Bits "cargo_A" (Kay Lousberg, CC0): a 0.5 m cargo box with every edge
// chamfered, red lid half over a white base, an orange label on two sides and a screw cap on the lid.
import { circle, shape } from './kit.js';

/** Palette by height: white base, red lid, lighter chamfers and caps (sampled from the atlas). */
const body = (/** @type {number} */ y, /** @type {string} */ side) => {
  if (side === 'top') return 0xde3e42;
  if (side === 'bottom') return 0xcfd7da;
  if (y > 0.4375) return 0xe85558;
  if (y > 0.25) return 0xdd3a3e;
  return y < 0.0625 ? 0xd7dde0 : 0xd4dcdf;
};
const label = (/** @type {number} */ _y, /** @type {string} */ side) => (side === 'top' ? 0xd29a47 : side === 'bottom' ? 0xca8e40 : 0xcf9645);

/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const s = shape(THREE)
    .box({ hx: 0.1875, hy: 0.1875, hz: 0.1875, r: 0.0625, cy: 0.25, cuts: [0.25] }, body)
    .box({ hx: 0.077, hy: 0.047, hz: 0.005, r: 0, cx: -0.1, cy: 0.126, cz: 0.255 }, label) // front label
    .box({ hx: 0.077, hy: 0.047, hz: 0.005, r: 0, cx: 0.1, cy: 0.126, cz: -0.255 }, label) // back label
    .loft([{ y: 0.5, pts: circle(0.05, 8) }, { y: 0.52, pts: circle(0.039, 8) }], (_y, side) => (side === 'top' ? 0x8b979c : 0x7b858a), { cx: 0.1, cz: 0.1 }); // screw cap
  const crate = new THREE.Mesh(s.build(50), new THREE.MeshStandardMaterial({ name: 'spacebits_texture', vertexColors: true, roughness: 0.6 }));
  crate.name = 'cargo_A';
  return crate;
};
