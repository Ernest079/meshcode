// Test fixture: box + cylinder + cone (all detectable primitives), hierarchy, materials and a canvas texture.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  // Procedural wood grain: stripes drawn on a canvas, exported as a PNG inside the GLB.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  for (let x = 0; x < 64; x += 4) {
    ctx.fillStyle = x % 8 ? '#7a4a24' : '#5c3418';
    ctx.fillRect(x, 0, 4, 64);
  }
  const wood = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a40, metalness: 0.8, roughness: 0.4 });
  const flame = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6010, emissiveIntensity: 2 });

  const torch = new THREE.Group();
  torch.name = 'torch';

  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.1), iron);
  bracket.name = 'bracket';
  bracket.position.set(0, 0, -0.25);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.8, 8), wood);
  handle.name = 'handle';
  handle.rotation.x = -0.35;

  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 8), flame);
  fire.name = 'flame';
  fire.position.set(0, 0.5, 0.15);

  torch.add(bracket, handle, fire);
  return torch;
};
