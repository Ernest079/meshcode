// Test fixture: one InstancedMesh (exported as EXT_mesh_gpu_instancing).
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  const size = 0.5;
  const crates = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.8 }),
    6,
  );
  crates.name = 'crates';
  const m = new THREE.Matrix4();
  // 3 on the floor, 2 on top, 1 on the summit; the slight yaw keeps it from looking machine-made.
  const slots = [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]];
  slots.forEach(([x, y], i) => {
    m.makeRotationY(i * 0.13).setPosition(x * size * 1.05, y * size + size / 2, 0);
    crates.setMatrixAt(i, m);
  });
  return crates;
};
