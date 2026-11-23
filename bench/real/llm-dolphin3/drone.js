export default (THREE) => {
  const root = new THREE.Group();
  const width = 1.2;
  const height = 0.875;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cubeSize = 0.6;
  const antennaLength = 0.12;
  const knobSize = 0.03;
  const blasterSize = 0.15; // diameter
  const materials = [
    new THREE.MeshStandardMaterial({ color: '#ed563e', roughness: 0.2, metalness: 0.0 }),
    new THREE.MeshStandardMaterial({ color: '#3b3b41', roughness: 0.2, metalness: 0.0 }),
  ];

  materials.forEach((material, index) => {
    const colorMap = new THREE.CanvasTexture(document.createElement('canvas'));
    colorMap.map.width = colorMap.map.height = 64;
    const canvas = colorMap.map.canvas;
    const ctx = canvas.getContext('2d');
    if (index < 2) {
      ctx.drawImage(document.createElement('canvas'), 0, 0, 64, 64);
    }
    material.map = colorMap;
    material.colorSpace = THREE.SRGBColorSpace;
  });

  const torso = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize - 0.1);
  const faceplate = new THREE.PlaneGeometry(0.45, 0.45, 16);

  const blasterGeometry = new THREE.CylinderGeometry(0.075, blasterSize, 0.45);
  const antennaGeometry = new THREE.ConeGeometry(antennaLength, 0.01, 8);

  const faceplateMesh = new THREE.Mesh(faceplate, materials[0]);
  faceplateMesh.position.set(halfWidth + 0.05, halfHeight, 0.3);
  faceplateMesh.rotation.x = Math.PI / 2;

  const knob = new THREE.SphereGeometry(knobSize);
  const antennaMesh = new THREE.Mesh(antennaGeometry, materials[1]);
  antennaMesh.position.set(halfWidth, halfHeight + 0.55, antennaLength);
  antennaMesh.add(new THREE.Mesh(knob, materials[1]));

  const blasterMeshLeft = new THREE.InstancedMesh(blasterGeometry, materials[1], 1);
  blasterMeshLeft.instance.count = 1;
  blasterMeshLeft.instance.position.set(halfWidth - 0.05, halfHeight - 0.15, blasterSize / 2);
  blasterMeshLeft.instance.rotation.y = Math.PI;
  const blasterMeshRight = blasterMeshLeft.clone();
  blasterMeshRight.instance.position.set(halfWidth + 0.05, halfHeight - 0.15, blasterSize / 2);
  blasterMeshRight.instance.rotation.y = -Math.PI;

  torso = new THREE.Mesh(torso, materials);
  torso.position.set(halfWidth, halfHeight, 0.05);
  root.add(torso);
  root.add(faceplateMesh);
  root.add(antennaMesh);
  root.add(new THREE.Mesh(blasterGeometry, materials[1]));
  root.add(blasterMeshLeft);
  root.add(blasterMeshRight);

  return root;
};
