// @ts-check
// Browser core: Object3D → engine-native source (Godot 4 GDScript, Unity C#).
// Not a JavaScript transpiler: the model code runs first, and the RESULTING scene graph is exported,
// so loops, randomness and canvas textures in the source are already resolved.
import * as THREE from 'three';
import { base64, detectPrimitive, textureImage } from './decompile.js';

/** @typedef {{ code: string, filename: string, warnings: string[], meshes: { name: string, kind: 'primitive' | 'data', instances: number }[] }} EngineExport */

const num = (/** @type {number} */ v) => {
  const n = Number(v.toPrecision(7));
  return Object.is(n, -0) ? 0 : n;
};
const pascal = (/** @type {string} */ s) => {
  const p = s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
  return /^[A-Za-z_]/.test(p) ? p : `Model${p}`;
};
const snake = (/** @type {string} */ s) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'model';

// ponytail: animations only travel in the GLB (both engines import its clips); generate AnimationPlayer / AnimationClip code if needed.
const animationWarning = (/** @type {THREE.Object3D} */ root) =>
  root.animations.length ? [`${root.animations.length} animation(s) not included here: export GLB, which Godot and Unity import with its animations`] : [];

const hasMaps = (/** @type {any} */ m) => ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'].some((k) => m[k]);
const firstMap = (/** @type {any} */ m) => m.map ?? m.normalMap ?? m.roughnessMap ?? m.metalnessMap ?? m.emissiveMap ?? m.aoMap ?? null;

/**
 * Geometry → engine arrays (base64): optional flat normals (three's flatShading has no engine
 * equivalent, so it is baked into per-face normals), V flip, Z mirror (Unity), and reversed winding
 * (Godot and Unity both treat clockwise triangles as front-facing; three.js uses counter-clockwise).
 * @param {THREE.BufferGeometry} geo
 * @param {{ flat?: boolean, flipV?: boolean, mirrorZ?: boolean }} opts
 */
function meshArrays(geo, { flat = false, flipV = false, mirrorZ = false }) {
  let g = geo;
  if (flat) {
    g = g.index ? g.toNonIndexed() : g.clone();
    g.computeVertexNormals();
  }
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const z = mirrorZ ? -1 : 1;
  const P = new Float32Array(pos.count * 3);
  const N = nor ? new Float32Array(nor.count * 3) : null;
  const U = uv ? new Float32Array(uv.count * 2) : null;
  for (let i = 0; i < pos.count; i++) {
    P.set([pos.getX(i), pos.getY(i), pos.getZ(i) * z], i * 3);
    if (N && nor) N.set([nor.getX(i), nor.getY(i), nor.getZ(i) * z], i * 3);
    if (U && uv) U.set([uv.getX(i), flipV ? 1 - uv.getY(i) : uv.getY(i)], i * 2);
  }
  const count = g.index ? g.index.count : pos.count;
  const at = (/** @type {number} */ k) => (g.index ? g.index.getX(k) : k);
  const I = new Int32Array(count);
  for (let t = 0; t < count; t += 3) [I[t], I[t + 1], I[t + 2]] = [at(t), at(t + 2), at(t + 1)];
  if (g !== geo) g.dispose();
  return { p: base64(P), n: N ? base64(N) : null, uv: U ? base64(U) : null, i: base64(I) };
}

/** Local rotation for a Spot/Directional light so that its −Z axis points at its target. @param {any} light */
function lightQuaternion(light) {
  if (!light.target) return light.quaternion;
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  const eye = new THREE.Vector3().setFromMatrixPosition(light.matrixWorld);
  const at = new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld);
  const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, at, new THREE.Vector3(0, 1, 0)));
  const parent = new THREE.Quaternion();
  light.parent?.getWorldQuaternion(parent);
  return parent.invert().multiply(world);
}

/** Shared walk: calls visitors in scene order (pre-order), skipping light targets. */
function walk(/** @type {THREE.Object3D} */ o, /** @type {(o: THREE.Object3D, parentId: string) => string} */ visit, parentId = 'model') {
  const id = visit(o, parentId);
  const target = /** @type {any} */ (o).target;
  for (const child of o.children) if (child !== target) walk(child, visit, id);
}

// ======================================================================= Godot 4 (GDScript)

/**
 * @param {THREE.Object3D} root
 * @param {{ source?: string }} [opts]
 * @returns {EngineExport}
 */
export function toGodot(root, opts = {}) {
  root.updateMatrixWorld(true);
  /** @type {string[]} */ const lines = [], data = [], warnings = animationWarning(root);
  /** @type {EngineExport['meshes']} */ const meshes = [];
  const cache = new Map();
  let n = 0;
  const v3 = (/** @type {number[]} */ a) => `Vector3(${a.map(num).join(', ')})`;
  const color = (/** @type {THREE.Color} */ c, alpha = 1) => `Color("#${c.getHexString()}"${alpha !== 1 ? `, ${num(alpha)}` : ''})`;
  const once = (/** @type {string} */ key, /** @type {() => string} */ make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };

  const texture = (/** @type {THREE.Texture} */ t) => once(`tex:${t.uuid}`, () => {
    const id = `tex${n++}`, img = textureImage(t);
    data.push(`\t"${id}": "${img.data}",`);
    lines.push(`var ${id} := _texture(D["${id}"], ${img.mime === 'image/jpeg'})`);
    return id;
  });

  const material = (/** @type {any} */ m, /** @type {boolean} */ instanceColors) => once(`mat:${m.uuid}:${instanceColors}`, () => {
    const id = `mat${n++}`;
    const set = (/** @type {string} */ prop, /** @type {string | number | boolean} */ value) => lines.push(`${id}.${prop} = ${value}`);
    lines.push(`var ${id} := StandardMaterial3D.new()`);
    if (m.name) set('resource_name', JSON.stringify(m.name));
    if (m.color && (m.color.getHex() !== 0xffffff || m.opacity !== 1)) set('albedo_color', color(m.color, m.transparent ? m.opacity : 1));
    if (m.type === 'MeshBasicMaterial') set('shading_mode', 'BaseMaterial3D.SHADING_MODE_UNSHADED');
    else if (m.type !== 'MeshStandardMaterial' && m.type !== 'MeshPhysicalMaterial') warnings.push(`${m.type}: approximated as StandardMaterial3D`);
    if (m.metalness) set('metallic', num(m.metalness));
    if (m.roughness !== undefined && m.roughness !== 1) set('roughness', num(m.roughness));
    if (m.transparent) set('transparency', 'BaseMaterial3D.TRANSPARENCY_ALPHA');
    if (m.depthWrite === false) set('depth_draw_mode', 'BaseMaterial3D.DEPTH_DRAW_DISABLED');
    if (m.side === THREE.DoubleSide) set('cull_mode', 'BaseMaterial3D.CULL_DISABLED');
    if (m.side === THREE.BackSide) set('cull_mode', 'BaseMaterial3D.CULL_FRONT');
    if (m.emissive && m.emissive.getHex() !== 0) {
      set('emission_enabled', true);
      set('emission', color(m.emissive));
      if (m.emissiveIntensity !== 1) set('emission_energy_multiplier', num(m.emissiveIntensity));
    }
    if (instanceColors) set('vertex_color_use_as_albedo', true);
    if (m.map) set('albedo_texture', texture(m.map));
    if (m.emissiveMap) {
      set('emission_enabled', true);
      set('emission_texture', texture(m.emissiveMap));
    }
    if (m.normalMap) {
      set('normal_enabled', true);
      set('normal_texture', texture(m.normalMap));
      if (m.normalScale.x !== 1) set('normal_scale', num(m.normalScale.x));
    }
    if (m.roughnessMap) { // glTF packs roughness in G and metalness in B of one texture
      set('roughness_texture', texture(m.roughnessMap));
      set('roughness_texture_channel', 'BaseMaterial3D.TEXTURE_CHANNEL_GREEN');
    }
    if (m.metalnessMap) {
      set('metallic_texture', texture(m.metalnessMap));
      set('metallic_texture_channel', 'BaseMaterial3D.TEXTURE_CHANNEL_BLUE');
    }
    if (m.aoMap) {
      set('ao_enabled', true);
      set('ao_texture', texture(m.aoMap));
    }
    const t = firstMap(m);
    if (t) {
      if (t.repeat.x !== 1 || t.repeat.y !== 1) set('uv1_scale', v3([t.repeat.x, t.repeat.y, 1]));
      if (t.offset.x || t.offset.y) warnings.push(`${m.name || id}: texture offset not exported`);
      if (t.wrapS === THREE.ClampToEdgeWrapping && t.wrapT === THREE.ClampToEdgeWrapping) set('texture_repeat', false);
      if (t.magFilter === THREE.NearestFilter) set('texture_filter', 'BaseMaterial3D.TEXTURE_FILTER_NEAREST');
    }
    return id;
  });

  /** Primitive resource when Godot's primitive matches exactly (no textures: Godot's box UVs differ). */
  const mesh = (/** @type {THREE.BufferGeometry} */ g, /** @type {any} */ m) => {
    const flat = !!m.flatShading;
    const prim = !flat && !hasMaps(m) ? detectPrimitive(g) : null;
    const flipV = firstMap(m)?.flipY !== false; // Godot UV origin is top-left; three flips on upload by default
    return {
      kind: /** @type {'primitive' | 'data'} */ (prim ? 'primitive' : 'data'),
      id: once(`mesh:${g.uuid}:${prim ? 'p' : `${flat}:${flipV}`}`, () => {
        const id = `mesh${n++}`;
        const p = prim?.params;
        if (prim?.kind === 'box') lines.push(`var ${id} := BoxMesh.new()`, `${id}.size = ${v3([p.width, p.height, p.depth])}`);
        else if (prim?.kind === 'plane') {
          lines.push(`var ${id} := PlaneMesh.new()`, `${id}.orientation = PlaneMesh.FACE_Z`, `${id}.size = Vector2(${num(p.width)}, ${num(p.height)})`);
          if (p.widthSegments > 1) lines.push(`${id}.subdivide_width = ${p.widthSegments - 1}`);
          if (p.heightSegments > 1) lines.push(`${id}.subdivide_depth = ${p.heightSegments - 1}`);
        } else if (prim?.kind === 'cylinder' || prim?.kind === 'cone') {
          const top = prim.kind === 'cone' ? 0 : p.radiusTop, bottom = prim.kind === 'cone' ? p.radius : p.radiusBottom;
          lines.push(`var ${id} := CylinderMesh.new()`, `${id}.top_radius = ${num(top)}`, `${id}.bottom_radius = ${num(bottom)}`,
            `${id}.height = ${num(p.height)}`, `${id}.radial_segments = ${p.radialSegments}`, `${id}.rings = ${p.heightSegments - 1}`);
          if (p.openEnded || top === 0) lines.push(`${id}.cap_top = false`);
          if (p.openEnded) lines.push(`${id}.cap_bottom = false`);
        } else if (prim?.kind === 'sphere') {
          lines.push(`var ${id} := SphereMesh.new()`, `${id}.radius = ${num(p.radius)}`, `${id}.height = ${num(p.radius * 2)}`,
            `${id}.radial_segments = ${p.widthSegments}`, `${id}.rings = ${p.heightSegments - 1}`);
        } else {
          const a = meshArrays(g, { flat, flipV });
          data.push(`\t"${id}": { "p": "${a.p}"${a.n ? `, "n": "${a.n}"` : ''}${a.uv ? `, "uv": "${a.uv}"` : ''}, "i": "${a.i}" },`);
          lines.push(`var ${id} := _mesh(D["${id}"])`);
        }
        return id;
      }),
    };
  };

  /** Position / rotation (quaternion: no Euler-order mismatch) / scale. */
  const place = (/** @type {string} */ id, /** @type {THREE.Object3D} */ o, q = o.quaternion) => {
    if (o.position.lengthSq()) lines.push(`${id}.position = ${v3(o.position.toArray())}`);
    if (q.w !== 1) lines.push(`${id}.quaternion = Quaternion(${[q.x, q.y, q.z, q.w].map(num).join(', ')})`);
    if (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1) lines.push(`${id}.scale = ${v3(o.scale.toArray())}`);
  };

  walk(root, (o, parent) => {
    const id = `node${n++}`;
    const any = /** @type {any} */ (o);
    lines.push('');
    if (any.isMesh) {
      if (Array.isArray(any.material)) warnings.push(`${o.name || id}: multi-material mesh, first material used`);
      const m = [any.material].flat()[0];
      const inst = any.isInstancedMesh ? /** @type {THREE.InstancedMesh} */ (o) : null;
      const geo = mesh(any.geometry, m);
      const mat = material(m, !!inst?.instanceColor);
      if (inst) {
        const mm = `multimesh${n++}`, rows = [], colors = [];
        const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, mtx).decompose(p, q, s);
          rows.push(`[${[...p.toArray(), q.x, q.y, q.z, q.w, ...s.toArray()].map(num).join(', ')}]`);
          if (inst.instanceColor) colors.push(`"#${inst.getColorAt(i, c).getHexString()}"`);
        }
        data.push(`\t"${mm}": [${rows.join(', ')}],`);
        if (colors.length) data.push(`\t"${mm}_colors": [${colors.join(', ')}],`);
        lines.push(
          `var ${mm} := MultiMesh.new()`,
          `${mm}.resource_name = "${mm}" # its instance table is D["${mm}"]`,
          `${mm}.transform_format = MultiMesh.TRANSFORM_3D`,
          ...(colors.length ? [`${mm}.use_colors = true`] : []),
          `${mm}.mesh = ${geo.id}`,
          `${mm}.instance_count = ${inst.count}`,
          `for i in ${mm}.instance_count: # position xyz, rotation quaternion xyzw, scale xyz`,
          `\tvar t: Array = D["${mm}"][i]`,
          `\t${mm}.set_instance_transform(i, Transform3D(Basis(Quaternion(t[3], t[4], t[5], t[6])) * Basis.from_scale(Vector3(t[7], t[8], t[9])), Vector3(t[0], t[1], t[2])))`,
          ...(colors.length ? [`\t${mm}.set_instance_color(i, Color(D["${mm}_colors"][i]))`] : []),
          `var ${id} := MultiMeshInstance3D.new()`,
          `${id}.multimesh = ${mm}`,
        );
      } else {
        lines.push(`var ${id} := MeshInstance3D.new()`, `${id}.mesh = ${geo.id}`);
      }
      lines.push(`${id}.material_override = ${mat}`);
      meshes.push({ name: o.name, kind: geo.kind, instances: inst ? inst.count : 1 });
    } else if (any.isPointLight || any.isSpotLight || any.isDirectionalLight) {
      const type = any.isPointLight ? 'OmniLight3D' : any.isSpotLight ? 'SpotLight3D' : 'DirectionalLight3D';
      lines.push(`var ${id} := ${type}.new() # intensity units differ between engines: tune light_energy`,
        `${id}.light_color = ${color(any.color)}`, `${id}.light_energy = ${num(any.intensity)}`);
      if (any.isPointLight) lines.push(`${id}.omni_range = ${num(any.distance || 20)}`);
      if (any.isSpotLight) lines.push(`${id}.spot_range = ${num(any.distance || 20)}`, `${id}.spot_angle = ${num(THREE.MathUtils.radToDeg(any.angle))}`);
    } else {
      if (!any.isGroup && o.type !== 'Object3D' && o.type !== 'Scene') warnings.push(`${o.name || id}: ${o.type} exported as an empty Node3D`);
      lines.push(`var ${id} := Node3D.new()`);
    }
    if (o.name) lines.push(`${id}.name = ${JSON.stringify(o.name)}`);
    place(id, o, any.isSpotLight || any.isDirectionalLight ? lightQuaternion(any) : o.quaternion);
    lines.push(`${parent}.add_child(${id}, true) # true: readable unique names for same-named siblings`);
    return id;
  });

  const title = root.name || 'model';
  const code = `@tool
extends Node3D
## ${title} — generated by meshcode${opts.source ? ` from ${opts.source}` : ''}.
## Attach this script to a Node3D. The model is rebuilt under a child named "Model" when the scene
## runs (and live in the editor, thanks to @tool). Primitive meshes (BoxMesh, CylinderMesh, …) stay
## editable below; other shapes are exact vertex data at the end of the file.


func _ready() -> void:
\tvar old := get_node_or_null("Model")
\tif old:
\t\told.free()
\tvar model := Node3D.new()
\tmodel.name = "Model"
\tadd_child(model)
\t_build(model)


func _build(model: Node3D) -> void:
${lines.map((l) => (l ? `\t${l}` : '')).join('\n')}


static func _vec3(b64: String) -> PackedVector3Array:
\tvar f := Marshalls.base64_to_raw(b64).to_float32_array()
\tvar out := PackedVector3Array()
\tout.resize(f.size() / 3)
\tfor i in out.size():
\t\tout[i] = Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2])
\treturn out


static func _vec2(b64: String) -> PackedVector2Array:
\tvar f := Marshalls.base64_to_raw(b64).to_float32_array()
\tvar out := PackedVector2Array()
\tout.resize(f.size() / 2)
\tfor i in out.size():
\t\tout[i] = Vector2(f[i * 2], f[i * 2 + 1])
\treturn out


static func _mesh(d: Dictionary) -> ArrayMesh:
\tvar arrays := []
\tarrays.resize(Mesh.ARRAY_MAX)
\tarrays[Mesh.ARRAY_VERTEX] = _vec3(d["p"])
\tif d.has("n"):
\t\tarrays[Mesh.ARRAY_NORMAL] = _vec3(d["n"])
\tif d.has("uv"):
\t\tarrays[Mesh.ARRAY_TEX_UV] = _vec2(d["uv"])
\tarrays[Mesh.ARRAY_INDEX] = Marshalls.base64_to_raw(d["i"]).to_int32_array()
\tvar mesh := ArrayMesh.new()
\tmesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
\treturn mesh


static func _texture(b64: String, jpeg: bool) -> ImageTexture:
\tvar image := Image.new()
\tvar bytes := Marshalls.base64_to_raw(b64)
\tif jpeg:
\t\timage.load_jpg_from_buffer(bytes)
\telse:
\t\timage.load_png_from_buffer(bytes)
\timage.generate_mipmaps()
\treturn ImageTexture.create_from_image(image)


# Vertex data (base64 float32 / int32), instance transforms and textures.
const D := {
${data.join('\n')}
}
`;
  return { code, filename: `${snake(title)}.gd`, warnings, meshes };
}

// ======================================================================= Unity (C#), experimental

/**
 * @param {THREE.Object3D} root
 * @param {{ source?: string }} [opts]
 * @returns {EngineExport}
 */
export function toUnity(root, opts = {}) {
  root.updateMatrixWorld(true);
  /** @type {string[]} */ const lines = [], data = [], warnings = animationWarning(root);
  /** @type {EngineExport['meshes']} */ const meshes = [];
  const cache = new Map();
  let n = 0;
  const f = (/** @type {number} */ v) => `${num(v)}f`;
  // Mirror Z: right-handed three.js → left-handed Unity (three's −Z forward becomes Unity's +Z).
  const v3 = (/** @type {number[]} */ [x, y, z]) => `new Vector3(${f(x)}, ${f(y)}, ${f(-z)})`;
  const quat = (/** @type {THREE.Quaternion} */ q) => (q.w === 1 ? 'Quaternion.identity' : `new Quaternion(${f(-q.x)}, ${f(-q.y)}, ${f(q.z)}, ${f(q.w)})`);
  const scale = (/** @type {THREE.Vector3} */ s) => (s.x === 1 && s.y === 1 && s.z === 1 ? 'Vector3.one' : `new Vector3(${f(s.x)}, ${f(s.y)}, ${f(s.z)})`);
  const hex = (/** @type {THREE.Color} */ c) => `"#${c.getHexString()}"`;
  const once = (/** @type {string} */ key, /** @type {() => string} */ make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };

  const texture = (/** @type {THREE.Texture} */ t) => once(`tex:${t.uuid}`, () => {
    const id = `tex${n++}`, img = textureImage(t);
    data.push(`        public const string ${id} = "${img.data}";`);
    const clamp = t.wrapS === THREE.ClampToEdgeWrapping, nearest = t.magFilter === THREE.NearestFilter;
    lines.push(`var ${id} = Tex(D.${id}, clamp: ${clamp}, nearest: ${nearest});`);
    return id;
  });

  const material = (/** @type {any} */ m) => once(`mat:${m.uuid}`, () => {
    const id = `mat${n++}`;
    const unlit = m.type === 'MeshBasicMaterial';
    const emissive = m.emissive && m.emissive.getHex() !== 0 ? `${hex(m.emissive)}, ${f(m.emissiveIntensity ?? 1)}` : 'null, 0f';
    lines.push(`var ${id} = Mat(${JSON.stringify(m.name || id)}, ${hex(m.color ?? new THREE.Color(1, 1, 1))}, ${f(m.transparent ? m.opacity : 1)}, ` +
      `${f(m.metalness ?? 0)}, ${f(m.roughness ?? 1)}, ${emissive}, unlit: ${unlit}, doubleSided: ${m.side === THREE.DoubleSide});`);
    if (m.map) {
      lines.push(`SetMainTexture(${id}, ${texture(m.map)}, new Vector2(${f(m.map.repeat.x)}, ${f(m.map.repeat.y)}));`);
    }
    for (const k of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      if (m[k]) warnings.push(`${m.name || id}: ${k} not exported to Unity (different texture packing); base colour kept`);
    }
    return id;
  });

  const mesh = (/** @type {THREE.BufferGeometry} */ g, /** @type {any} */ m) => {
    const flat = !!m.flatShading;
    const flipV = firstMap(m)?.flipY === false; // Unity UV origin is bottom-left, like three's default flipY
    return once(`mesh:${g.uuid}:${flat}:${flipV}`, () => {
      const id = `mesh${n++}`;
      const a = meshArrays(g, { flat, flipV, mirrorZ: true });
      data.push(`        public const string ${id}_p = "${a.p}";`);
      if (a.n) data.push(`        public const string ${id}_n = "${a.n}";`);
      if (a.uv) data.push(`        public const string ${id}_uv = "${a.uv}";`);
      data.push(`        public const string ${id}_i = "${a.i}";`);
      lines.push(`var ${id} = LoadMesh(D.${id}_p, ${a.n ? `D.${id}_n` : 'null'}, ${a.uv ? `D.${id}_uv` : 'null'}, D.${id}_i);`);
      return id;
    });
  };

  walk(root, (o, parent) => {
    const id = `node${n++}`;
    const any = /** @type {any} */ (o);
    const q = any.isSpotLight || any.isDirectionalLight ? lightQuaternion(any) : o.quaternion;
    const name = JSON.stringify(o.name || o.type);
    lines.push('');
    lines.push(`var ${id} = Node(${name}, ${parent}, ${v3(o.position.toArray())}, ${quat(q)}, ${scale(o.scale)});`);
    if (any.isMesh) {
      if (Array.isArray(any.material)) warnings.push(`${o.name || id}: multi-material mesh, first material used`);
      const m = [any.material].flat()[0];
      const geo = mesh(any.geometry, m), mat = material(m);
      if (any.isInstancedMesh) {
        const inst = /** @type {THREE.InstancedMesh} */ (o);
        const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
        const rows = [];
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, mtx).decompose(p, r, s);
          const tint = inst.instanceColor ? `, Hex(${hex(inst.getColorAt(i, c))})` : '';
          rows.push(`MeshNode($"{${id}.name}_${i}", ${id}, ${v3(p.toArray())}, ${quat(r)}, ${scale(s)}, ${geo}, ${mat}${tint});`);
        }
        lines.push(`// ${inst.count} instances (three.js InstancedMesh → one GameObject each; consider GPU instancing for large counts)`, ...rows);
      } else {
        lines.push(`AddMesh(${id}, ${geo}, ${mat});`);
      }
      meshes.push({ name: o.name, kind: 'data', instances: any.isInstancedMesh ? any.count : 1 });
    } else if (any.isPointLight || any.isSpotLight || any.isDirectionalLight) {
      const type = any.isPointLight ? 'Point' : any.isSpotLight ? 'Spot' : 'Directional';
      lines.push(`AddLight(${id}, LightType.${type}, ${hex(any.color)}, ${f(any.intensity)}, ${f(any.distance || 20)}, ${f(any.isSpotLight ? THREE.MathUtils.radToDeg(any.angle) * 2 : 0)}); // intensity units differ: tune it`);
    } else if (!any.isGroup && o.type !== 'Object3D' && o.type !== 'Scene') {
      warnings.push(`${o.name || id}: ${o.type} exported as an empty GameObject`);
    }
    return id;
  });

  const cls = `${pascal(root.name || 'model')}Model`;
  const code = `// ${cls} — generated by meshcode${opts.source ? ` from ${opts.source}` : ''}.
// EXPERIMENTAL: this file is not compiled by meshcode's tests (no Unity there). Please report issues.
// Add the component to an empty GameObject: the model is built as children in Awake().
// three.js is right-handed and Unity left-handed, so positions/normals are mirrored on Z
// (three's −Z "forward" becomes Unity's +Z) and triangle winding is reversed.
// Works with the Built-in pipeline (Standard shader) and URP (Lit/Unlit), detected at runtime.
using System;
using UnityEngine;
using UnityEngine.Rendering;

public class ${cls} : MonoBehaviour
{
    void Awake() => Build();

    void Build()
    {
        var model = Node("Model", transform, Vector3.zero, Quaternion.identity, Vector3.one);
${lines.map((l) => (l ? `        ${l}` : '')).join('\n')}
    }

    // ----------------------------------------------------------------------- helpers
    static readonly bool Urp = GraphicsSettings.currentRenderPipeline != null;

    static Color Hex(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;

    static Transform Node(string name, Transform parent, Vector3 position, Quaternion rotation, Vector3 scale)
    {
        var t = new GameObject(name).transform;
        t.SetParent(parent, false);
        t.localPosition = position;
        t.localRotation = rotation;
        t.localScale = scale;
        return t;
    }

    static void AddMesh(Transform node, Mesh mesh, Material material, Color? tint = null)
    {
        node.gameObject.AddComponent<MeshFilter>().sharedMesh = mesh;
        var renderer = node.gameObject.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        if (tint is Color c)
        {
            var colorProperty = Urp ? "_BaseColor" : "_Color";
            var block = new MaterialPropertyBlock();
            block.SetColor(colorProperty, material.GetColor(colorProperty) * c);
            renderer.SetPropertyBlock(block);
        }
    }

    static Transform MeshNode(string name, Transform parent, Vector3 position, Quaternion rotation, Vector3 scale, Mesh mesh, Material material, Color? tint = null)
    {
        var node = Node(name, parent, position, rotation, scale);
        AddMesh(node, mesh, material, tint);
        return node;
    }

    static Material Mat(string name, string color, float alpha, float metallic, float roughness, string emission, float emissionIntensity, bool unlit, bool doubleSided)
    {
        var shader = Shader.Find(unlit ? (Urp ? "Universal Render Pipeline/Unlit" : "Unlit/Color") : (Urp ? "Universal Render Pipeline/Lit" : "Standard"));
        var m = new Material(shader) { name = name };
        var c = Hex(color);
        c.a = alpha;
        m.SetColor(Urp ? "_BaseColor" : "_Color", c);
        m.SetFloat("_Metallic", metallic);
        m.SetFloat(Urp ? "_Smoothness" : "_Glossiness", 1f - roughness);
        if (emission != null)
        {
            m.EnableKeyword("_EMISSION");
            m.SetColor("_EmissionColor", Hex(emission) * emissionIntensity);
        }
        if (alpha < 1f)
        {
            m.SetOverrideTag("RenderType", "Transparent");
            m.SetInt("_SrcBlend", (int)BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.renderQueue = (int)RenderQueue.Transparent;
            if (Urp) { m.SetFloat("_Surface", 1f); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); }
            else { m.SetFloat("_Mode", 3f); m.EnableKeyword("_ALPHAPREMULTIPLY_ON"); }
        }
        if (doubleSided && Urp) m.SetFloat("_Cull", (float)CullMode.Off);
        return m;
    }

    static void SetMainTexture(Material m, Texture2D texture, Vector2 tiling)
    {
        var property = Urp ? "_BaseMap" : "_MainTex";
        m.SetTexture(property, texture);
        m.SetTextureScale(property, tiling);
    }

    static Texture2D Tex(string base64, bool clamp, bool nearest)
    {
        var t = new Texture2D(2, 2);
        t.LoadImage(Convert.FromBase64String(base64));
        t.wrapMode = clamp ? TextureWrapMode.Clamp : TextureWrapMode.Repeat;
        t.filterMode = nearest ? FilterMode.Point : FilterMode.Bilinear;
        return t;
    }

    static float[] Floats(string base64)
    {
        var bytes = Convert.FromBase64String(base64);
        var f = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, f, 0, bytes.Length);
        return f;
    }

    static Mesh LoadMesh(string positions, string normals, string uvs, string indices)
    {
        var p = Floats(positions);
        var vertices = new Vector3[p.Length / 3];
        for (int i = 0; i < vertices.Length; i++) vertices[i] = new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        var mesh = new Mesh { indexFormat = IndexFormat.UInt32, vertices = vertices };
        if (normals != null)
        {
            var n = Floats(normals);
            var list = new Vector3[n.Length / 3];
            for (int i = 0; i < list.Length; i++) list[i] = new Vector3(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
            mesh.normals = list;
        }
        if (uvs != null)
        {
            var u = Floats(uvs);
            var list = new Vector2[u.Length / 2];
            for (int i = 0; i < list.Length; i++) list[i] = new Vector2(u[i * 2], u[i * 2 + 1]);
            mesh.uv = list;
        }
        var ib = Convert.FromBase64String(indices);
        var triangles = new int[ib.Length / 4];
        Buffer.BlockCopy(ib, 0, triangles, 0, ib.Length);
        mesh.triangles = triangles;
        if (normals == null) mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        return mesh;
    }

    static void AddLight(Transform node, LightType type, string color, float intensity, float range, float spotAngle)
    {
        var light = node.gameObject.AddComponent<Light>();
        light.type = type;
        light.color = Hex(color);
        light.intensity = intensity;
        light.range = range;
        if (type == LightType.Spot) light.spotAngle = spotAngle;
    }

    // ----------------------------------------------------------------------- data (base64 float32 / int32, textures)
    static class D
    {
${data.join('\n')}
    }
}
`;
  return { code, filename: `${cls}.cs`, warnings, meshes };
}
