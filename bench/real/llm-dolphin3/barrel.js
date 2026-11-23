export default (THREE) => {
  const root = new THREE.Group();
  const barrelMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xb91e4b),
    roughness: 0.5,
    metalness: 0.2
  });

  const barrelGeom = new THREE.BoxGeometry(0.453, 12, 100);

  const ringG1 = new THREE.BoxGeometry(0.5, 0.5, 100);
  const ringM1 = new THREE.BoxGeometry(0.55, 0.55, 100);
  const ringT1 = new THREE.BoxGeometry(0.65, 0.65, 100);

  const bottomCap = new THREE.BoxGeometry(0.453, 0.453, 0.1, 100);
  const topCap = new THREE.BoxGeometry(0.454, 0.454, 0.1, 100);

  const lidBottom = new THREE.Mesh(bottomCap, barrelMat);
  const lidTop = new THREE.Mesh(topCap, barrelMat);
  lidBottom.visible = false;
  lidTop.visible = false;

  root.add(lidBottom);
  root.add(lidTop);
  root.add(barrelGeom);
  root.add(ringG1);
  root.add(ringM1);
  root.add(ringT1);

  return root;
};
