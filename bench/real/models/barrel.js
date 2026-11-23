// @ts-check
// Code imitation of KayKit Prototype Bits "Barrel_A" (Kay Lousberg, CC0): a 12-sided lathe, 1 m tall,
// rings top and bottom and at mid-height, recessed lids; the palette runs from crimson (bottom) to orange (top).
import { circle, gradient, shape } from './kit.js';

// Profile (radius, height), from the bottom recess outwards, up the side and into the top recess.
const PROFILE = [
  [0, -0.4], [0.285, -0.4], [0.357, -0.5], [0.469, -0.5], [0.5, -0.475], [0.5, -0.337], [0.453, -0.295], [0.453, -0.104],
  [0.5, -0.061], [0.5, 0.061], [0.453, 0.104], [0.453, 0.295], [0.5, 0.337], [0.5, 0.475], [0.469, 0.5], [0.357, 0.5], [0.285, 0.4], [0, 0.4],
];
const paint = gradient([[-0.5, 0xb91e4b], [-0.45, 0xca303f], [-0.2, 0xcd333d], [0, 0xd94035], [0.2, 0xda4233], [0.4, 0xe34b2e], [0.5, 0xec5527]]);

/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const geo = shape(THREE).loft(PROFILE.map(([r, y]) => ({ y, pts: circle(r, 12) })), (y) => paint(y), { caps: false, smooth: true }).build();
  const barrel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'prototype_texture', vertexColors: true, roughness: 0.4 }));
  barrel.name = 'Barrel_A';
  return barrel;
};
