// Plasma bolt: an unlit capsule along +Z (the game aims +Z at the target).
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const geo = new THREE.CapsuleGeometry(0.06, 0.5, 4, 8);
  geo.rotateX(Math.PI / 2);
  const bolt = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ name: 'plasma', color: 0x7df9ff }));
  bolt.name = 'bolt';
  return bolt;
};
