// Supply crate, 1 m: one textured box whose origin is on the floor (bottom face at y = 0).
// The 512² texture (planks, painted steel frame, stencil, grain) is drawn on a canvas.
/** @param {typeof import('three')} THREE */
export default (THREE) => {
  let seed = 21;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  c.fillStyle = '#9a6b3c';
  c.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 6; k++) { // planks with grain streaks
    const y = 40 + k * 72;
    c.fillStyle = `rgb(${140 + rand() * 30},${95 + rand() * 20},${55 + rand() * 12})`;
    c.fillRect(40, y + 2, 432, 68);
    for (let s = 0; s < 22; s++) {
      c.fillStyle = `rgba(70,40,18,${0.15 + rand() * 0.25})`;
      c.fillRect(40 + rand() * 420, y + 4 + rand() * 60, 20 + rand() * 120, 1.5);
    }
  }
  c.strokeStyle = '#3d3f44'; // steel frame and diagonal brace
  c.lineWidth = 40;
  c.strokeRect(20, 20, 472, 472);
  c.lineWidth = 26;
  c.beginPath(); c.moveTo(40, 472); c.lineTo(472, 40); c.stroke();
  c.fillStyle = '#9ea3ab';
  for (const [x, y] of [[20, 20], [492, 20], [20, 492], [492, 492]]) { c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = 'rgba(230,230,220,0.75)'; // stencil arrows (shapes, not text: fonts differ per device)
  for (const x of [170, 256, 342]) { c.beginPath(); c.moveTo(x, 236); c.lineTo(x + 24, 268); c.lineTo(x - 24, 268); c.fill(); c.fillRect(x - 8, 268, 16, 26); }
  const img = c.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const crate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'crate', map, roughness: 0.8 }));
  crate.name = 'crate';
  return crate;
};
