import { BoxBufferGeometry, MeshStandardMaterial, TextBufferGeometry, FontLoader, Group, InstancedMesh, DodecahedronBufferGeometry } from 'three';

export default (THREE) => {
  const boxGeometry = new BoxBufferGeometry(0.25, 0.26, 0.5);
  const boxMaterialTop = new MeshStandardMaterial({ color: "#dd3a3e", roughness: 0.2, metalness: 0.1 });
  const boxMaterialBottom = new MeshStandardMaterial({ color: "#d4dcdf", roughness: 0.2, metalness: 0.1 });

  const labGeometry = new TextBufferGeometry('A', { font: new FontLoader().load("/path/to/font.ttf"), size: 0.05 });
  const labMaterial = new MeshStandardMaterial({ color: "#cf9645" });
  const label = new InstancedMesh(labGeometry, labMaterial, 1);

  const capGeometry = new DodecahedronBufferGeometry(0.025);
  const capMaterial = new MeshStandardMaterial({ color: "#7b858a" });
  const capMesh = new Mesh(capGeometry, capMaterial);

  const box = new Group();
  box.add(new Mesh(boxGeometry, boxMaterialBottom));
  box.add(new Mesh(boxGeometry, boxMaterialTop));
  box.add(label);
  box.add(capMesh);
  box.position.set(0, -0.26, 0);
  box.rotation.set(0, -Math.PI / 2, 0);
  return box;
};
