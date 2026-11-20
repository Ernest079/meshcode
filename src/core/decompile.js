// @ts-check
// Browser core: Object3D (usually from a GLB) → readable three.js module source.
// Geometry that exactly matches a three.js primitive becomes a constructor call;
// anything else is kept losslessly as base64 vertex data.
import * as THREE from 'three';
import { imageSources } from './glb.js';

/** Round to 7 significant digits (float32 noise off: 0.30000001192 → 0.3) and kill -0. */
const num = (/** @type {number} */ v) => {
  const n = Number(v.toPrecision(7));
  return Object.is(n, -0) ? 0 : n;
};
const args = (/** @type {number[]} */ a) => a.map(num).join(', ');
const hex = (/** @type {THREE.Color} */ c) => `0x${c.getHexString()}`;

/** Bytes → base64 without blowing the call stack on big buffers. @param {ArrayBufferView} view */
export function base64(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------- primitive detection

/**
 * True when `cand` reproduces `geo` vertex-for-vertex (positions and index).
 * @param {THREE.BufferGeometry} geo @param {THREE.BufferGeometry} cand @param {number} tol
 */
function sameGeometry(geo, cand, tol) {
  const a = geo.attributes.position, b = cand.attributes.position;
  if (a.count !== b.count || !!geo.index !== !!cand.index) return false;
  if (geo.index && cand.index && geo.index.count !== cand.index.count) return false;
  for (let i = 0; i < a.count; i++) {
    if (Math.abs(a.getX(i) - b.getX(i)) > tol || Math.abs(a.getY(i) - b.getY(i)) > tol || Math.abs(a.getZ(i) - b.getZ(i)) > tol) return false;
  }
  if (geo.index && cand.index) {
    for (let i = 0; i < geo.index.count; i++) if (geo.index.getX(i) !== cand.index.getX(i)) return false;
  }
  // Same shape is not enough: custom UVs (texture scale) or edited normals must survive too.
  for (const name of ['uv', 'normal']) {
    const x = geo.attributes[name], y = cand.attributes[name];
    if (!x) continue;
    if (!y || x.count !== y.count || x.itemSize !== y.itemSize) return false;
    for (let i = 0; i < x.count; i++) for (let c = 0; c < x.itemSize; c++) if (Math.abs(x.getComponent(i, c) - y.getComponent(i, c)) > 1e-4) return false;
  }
  return true;
}

/**
 * Try box, plane, cylinder/cone and sphere with parameters inferred from the vertices.
 * Only default theta/phi ranges are recognized; anything else falls back to data.
 * @param {THREE.BufferGeometry} geo
 * @returns {{ kind: string, code: string, params: Record<string, any> } | null}
 */
export function detectPrimitive(geo) {
  const pos = geo.attributes.position;
  if (!pos || pos.itemSize !== 3) return null;
  geo.computeBoundingBox();
  const box = /** @type {THREE.Box3} */ (geo.boundingBox);
  const size = box.getSize(new THREE.Vector3());
  const tol = 1e-5 * Math.max(1, size.length());
  const n = pos.count;
  /** @param {THREE.BufferGeometry} cand @param {string} kind @param {string} code */
  const tryCand = (cand, kind, code) => {
    const params = /** @type {any} */ (cand).parameters;
    const ok = sameGeometry(geo, cand, tol);
    cand.dispose();
    return ok ? { kind, code, params } : null;
  };

  if (n === 24) {
    const r = tryCand(new THREE.BoxGeometry(size.x, size.y, size.z), 'box', `new THREE.BoxGeometry(${args([size.x, size.y, size.z])})`);
    if (r) return r;
  }

  // Plane: grid of (ws+1)·(hs+1) vertices in z = 0.
  if (Math.abs(box.min.z) <= tol && Math.abs(box.max.z) <= tol) {
    for (let ws = 1; ws < n; ws++) {
      const hs = n / (ws + 1) - 1;
      if (!Number.isInteger(hs) || hs < 1) continue;
      const tail = ws === 1 && hs === 1 ? '' : `, ${ws}, ${hs}`;
      const r = tryCand(new THREE.PlaneGeometry(size.x, size.y, ws, hs), 'plane', `new THREE.PlaneGeometry(${args([size.x, size.y])}${tail})`);
      if (r) return r;
    }
  }

  // Cylinder / cone: radii read from the top and bottom rims.
  const h = size.y, half = h / 2;
  let rTop = 0, rBottom = 0, rMax = 0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (Math.abs(y - half) <= tol) rTop = Math.max(rTop, r);
    if (Math.abs(y + half) <= tol) rBottom = Math.max(rBottom, r);
    rMax = Math.max(rMax, Math.hypot(x, y, z));
  }
  if (h > tol && rBottom > tol) {
    for (const open of [false, true]) {
      const caps = open ? 0 : (rTop > tol ? 1 : 0) + 1;
      for (let rs = 3; rs <= 256; rs++) {
        const rest = n - caps * (2 * rs + 1);
        if (rest <= 0 || rest % (rs + 1)) continue;
        const hs = rest / (rs + 1) - 1;
        if (hs < 1) continue;
        const tail = hs === 1 && !open ? '' : `, ${hs}${open ? ', true' : ''}`;
        const cone = rTop <= tol;
        const cand = cone
          ? new THREE.ConeGeometry(rBottom, h, rs, hs, open)
          : new THREE.CylinderGeometry(rTop, rBottom, h, rs, hs, open);
        const code = cone
          ? `new THREE.ConeGeometry(${args([rBottom, h])}, ${rs}${tail})`
          : `new THREE.CylinderGeometry(${args([rTop, rBottom, h])}, ${rs}${tail})`;
        const r = tryCand(cand, cone ? 'cone' : 'cylinder', code);
        if (r) return r;
      }
    }
  }

  // Sphere: (ws+1)·(hs+1) vertices, radius = farthest vertex.
  for (let ws = 3; ws < n; ws++) {
    const hs = n / (ws + 1) - 1;
    if (!Number.isInteger(hs) || hs < 2) continue;
    const r = tryCand(new THREE.SphereGeometry(rMax, ws, hs), 'sphere', `new THREE.SphereGeometry(${args([rMax])}, ${ws}, ${hs})`);
    if (r) return r;
  }
  return null;
}

/**
 * Encoded bytes of a texture's image: the original JPEG/PNG from a GLB when available (no re-encode),
 * otherwise the decoded pixels re-encoded as PNG.
 * @param {THREE.Texture} t
 * @returns {{ data: string, mime: string, ext: string }} base64 data
 */
export function textureImage(t) {
  const original = imageSources.get(t.source);
  const ext = original && IMAGE_EXT[original.mimeType];
  if (original && ext) return { data: base64(original.bytes), mime: original.mimeType, ext };
  const img = /** @type {CanvasImageSource & { width: number, height: number }} */ (t.image);
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(img, 0, 0);
  return { data: canvas.toDataURL('image/png').split(',')[1], mime: 'image/png', ext: 'png' };
}

// ---------------------------------------------------------------- code generation

// Material properties carried over when they differ from the three.js default (shared with fidelity.js).
export const MATERIAL_SCALARS = /** @type {const} */ ([
  'roughness', 'metalness', 'emissiveIntensity', 'aoMapIntensity', 'opacity', 'transparent', 'alphaTest',
  'side', 'flatShading', 'vertexColors', 'wireframe', 'depthWrite', 'toneMapped',
  // MeshPhysicalMaterial (skipped automatically on other types)
  'clearcoat', 'clearcoatRoughness', 'ior', 'transmission', 'thickness', 'sheen', 'sheenRoughness',
  'iridescence', 'specularIntensity', 'dispersion', 'anisotropy',
]);
export const MATERIAL_COLORS = /** @type {const} */ (['color', 'emissive', 'specularColor', 'sheenColor', 'attenuationColor']);
// Vector2 props. GLTFLoader flips normalScale.y to -1 on meshes without tangents: dropping it inverts the relief.
export const MATERIAL_VECTORS = /** @type {const} */ (['normalScale', 'clearcoatNormalScale']);
export const MAP_SLOTS = /** @type {const} */ (['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']);
const SRGB_SLOTS = new Set(['map', 'emissiveMap']);
/** Constructor arguments after the colour, per light type (glTF KHR_lights_punctual). @type {Record<string, string[]>} */
const LIGHTS = {
  PointLight: ['intensity', 'distance', 'decay'],
  SpotLight: ['intensity', 'distance', 'angle', 'penumbra', 'decay'],
  DirectionalLight: ['intensity'],
};
/** @type {Record<string, string>} */
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** @type {Record<number, string>} */
const WRAP_NAMES = {
  [THREE.RepeatWrapping]: 'RepeatWrapping',
  [THREE.ClampToEdgeWrapping]: 'ClampToEdgeWrapping',
  [THREE.MirroredRepeatWrapping]: 'MirroredRepeatWrapping',
};

/** Valid, unique JS identifier from a node name. */
function makeNamer() {
  // Names the generated module itself uses.
  const used = new Set(['THREE', 'tex', 'data', 'loader', 'b64', 'geometry', 'TEXTURES']);
  return (/** @type {string} */ name, /** @type {string} */ fallback) => {
    let id = (name || fallback).replace(/[^A-Za-z0-9_$]/g, '_').replace(/^(?=\d)/, '_');
    const base = id;
    for (let i = 2; used.has(id); i++) id = `${base}${i}`;
    used.add(id);
    return id;
  };
}

/**
 * Decompile an Object3D into module source: `export default async (THREE) => Object3D`.
 * Textures become separate image files (original bytes when available) referenced relative to the module,
 * or, with `inlineTextures` (web app: no files), data URLs at the end of the module.
 * @param {THREE.Object3D} scene
 * @param {{ textureFile?: (index: number, ext: string) => string, source?: string, inlineTextures?: boolean }} [opts]
 * @returns {Promise<{ code: string, textures: { file: string, data: string, mime: string }[], summary: Record<string, number>, warnings: string[] }>}
 */
export async function decompile(scene, opts = {}) {
  const textureFile = opts.textureFile ?? ((i, ext) => `texture${i}.${ext}`);
  const name = makeNamer();
  /** @type {Record<string, number>} */
  const summary = {};
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */ const matLines = [];
  /** @type {string[]} */ const sceneLines = [];
  /** @type {string[]} */ const dataLines = [];
  /** @type {{ file: string, data: string, mime: string }[]} */ const textures = [];
  /** @type {string[]} */ const inlineLines = [];
  const matIds = new Map(), texIds = new Map(), geoIds = new Map();

  /** @param {THREE.Texture} t @param {string} slot */
  const textureRef = (t, slot) => {
    if (texIds.has(t)) return texIds.get(t);
    const image = textureImage(t);
    textures.push({ file: textureFile(textures.length, image.ext), data: image.data, mime: image.mime });
    const entry = textures[textures.length - 1];
    const id = name('', `tex${texIds.size}`);
    let src = `'./${entry.file}'`;
    if (opts.inlineTextures) {
      inlineLines.push(`  ${id}: 'data:${entry.mime};base64,${entry.data}',`);
      src = `TEXTURES.${id}`;
    }
    texIds.set(t, id);
    const extra = [];
    const wrap = (/** @type {number} */ w) => `THREE.${WRAP_NAMES[w] ?? 'RepeatWrapping'}`;
    if (t.wrapS !== THREE.RepeatWrapping) extra.push(`${id}.wrapS = ${wrap(t.wrapS)};`);
    if (t.wrapT !== THREE.RepeatWrapping) extra.push(`${id}.wrapT = ${wrap(t.wrapT)};`);
    if (t.repeat.x !== 1 || t.repeat.y !== 1) extra.push(`${id}.repeat.set(${args(t.repeat.toArray())});`);
    if (t.offset.x || t.offset.y) extra.push(`${id}.offset.set(${args(t.offset.toArray())});`);
    if (t.rotation) extra.push(`${id}.rotation = ${num(t.rotation)};`);
    if (t.center.x || t.center.y) extra.push(`${id}.center.set(${args(t.center.toArray())});`);
    if (t.channel) extra.push(`${id}.channel = ${t.channel};`);
    matLines.push(`const ${id} = await tex(${src}, ${SRGB_SLOTS.has(slot)});${extra.length ? ' ' + extra.join(' ') : ''}`);
    return id;
  };

  /** @param {THREE.Material} m */
  const materialRef = (m) => {
    if (matIds.has(m)) return matIds.get(m);
    const id = name(m.name ? `mat_${m.name}` : '', `mat${matIds.size}`);
    matIds.set(m, id);
    const Ctor = /** @type {any} */ (THREE)[m.type];
    if (typeof Ctor !== 'function') {
      warnings.push(`material type ${m.type} unsupported, used MeshStandardMaterial`);
      matLines.push(`const ${id} = new THREE.MeshStandardMaterial();`);
      return id;
    }
    const ref = new Ctor();
    const src = /** @type {any} */ (m);
    const props = [];
    if (m.name) props.push(`name: ${JSON.stringify(m.name)}`);
    for (const key of MATERIAL_COLORS) {
      if (src[key]?.isColor && ref[key] && !src[key].equals(ref[key])) props.push(`${key}: ${hex(src[key])}`);
    }
    for (const key of MATERIAL_SCALARS) {
      if (key in ref && src[key] !== ref[key]) props.push(`${key}: ${typeof src[key] === 'number' ? num(src[key]) : src[key]}`);
    }
    for (const key of MATERIAL_VECTORS) {
      if (src[key]?.isVector2 && ref[key] && !src[key].equals(ref[key])) props.push(`${key}: new THREE.Vector2(${args(src[key].toArray())})`);
    }
    for (const slot of MAP_SLOTS) if (src[slot]?.isTexture) props.push(`${slot}: ${textureRef(src[slot], slot)}`);
    matLines.push(`const ${id} = new THREE.${m.type}(${props.length ? `{ ${props.join(', ')} }` : ''});`);
    ref.dispose();
    return id;
  };

  /** @param {THREE.BufferGeometry} g */
  const geometryRef = (g) => {
    if (geoIds.has(g)) return geoIds.get(g);
    const prim = detectPrimitive(g);
    let expr;
    if (prim) {
      expr = prim.code;
      summary[prim.kind] = (summary[prim.kind] ?? 0) + 1;
    } else {
      // Lossless fallback: every attribute as float32 (dequantizes meshopt/KHR_mesh_quantization data).
      const gid = `geo${geoIds.size}`;
      const parts = [];
      for (const [attrName, attr] of Object.entries(g.attributes)) {
        const out = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
        parts.push(`${JSON.stringify(attrName)}: [${attr.itemSize}, '${base64(out)}']`);
      }
      let index = 'null';
      if (g.index) {
        const ids = Array.from({ length: g.index.count }, (_, i) => /** @type {THREE.BufferAttribute} */ (g.index).getX(i));
        const big = Math.max(...ids) > 65535;
        index = `['${big ? 'u32' : 'u16'}', '${base64(big ? new Uint32Array(ids) : new Uint16Array(ids))}']`;
      }
      dataLines.push(`  ${gid}: { attributes: { ${parts.join(', ')} }, index: ${index} },`);
      expr = `geometry(data.${gid})`;
      summary.data = (summary.data ?? 0) + 1;
    }
    const id = name('', `g${geoIds.size}`);
    geoIds.set(g, id);
    sceneLines.push(`const ${id} = ${expr};`);
    return id;
  };

  /** @param {THREE.Object3D} o @param {string} id */
  const transform = (o, id) => {
    const lines = [];
    if (o.name) lines.push(`${id}.name = ${JSON.stringify(o.name)};`);
    if (o.position.lengthSq() > 0) lines.push(`${id}.position.set(${args(o.position.toArray())});`);
    if (o.rotation.x || o.rotation.y || o.rotation.z) lines.push(`${id}.rotation.set(${args([o.rotation.x, o.rotation.y, o.rotation.z])});`);
    if (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1) lines.push(`${id}.scale.set(${args(o.scale.toArray())});`);
    return lines;
  };

  /** @param {THREE.Object3D} o @param {string | null} parent @returns {string} */
  const emit = (o, parent) => {
    const id = name(o.name, o.type.toLowerCase());
    const mesh = /** @type {THREE.Mesh} */ (o);
    if (mesh.isMesh && !(/** @type {any} */ (o)).isSkinnedMesh) {
      if (Array.isArray(mesh.material)) warnings.push(`${o.name || id}: multi-material mesh, kept first material`);
      const mat = materialRef(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
      const geo = geometryRef(mesh.geometry);
      if (mesh.geometry.morphAttributes && Object.keys(mesh.geometry.morphAttributes).length) warnings.push(`${o.name || id}: morph targets dropped`);
      const inst = /** @type {THREE.InstancedMesh} */ (o);
      if (inst.isInstancedMesh) {
        sceneLines.push(`const ${id} = new THREE.InstancedMesh(${geo}, ${mat}, ${inst.count});`);
        const rows = [];
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          m.decompose(p, q, s);
          e.setFromQuaternion(q);
          rows.push(`  [${args([...p.toArray(), e.x, e.y, e.z, ...s.toArray()])}],`);
        }
        sceneLines.push(`// instances: position xyz, rotation xyz (radians), scale xyz`);
        sceneLines.push(`[\n${rows.join('\n')}\n].forEach(([px, py, pz, rx, ry, rz, sx, sy, sz], i) => ${id}.setMatrixAt(i, new THREE.Matrix4().compose(` +
          `new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))));`);
        if (inst.instanceColor) {
          const c = new THREE.Color();
          const hexes = Array.from({ length: inst.count }, (_, i) => `0x${inst.getColorAt(i, c).getHexString()}`);
          sceneLines.push(`// per-instance colours (multiply the material colour)`);
          sceneLines.push(`[${hexes.join(', ')}].forEach((hex, i) => ${id}.setColorAt(i, new THREE.Color(hex)));`);
        }
        summary.instancedMesh = (summary.instancedMesh ?? 0) + 1;
      } else {
        sceneLines.push(`const ${id} = new THREE.Mesh(${geo}, ${mat});`);
      }
    } else if (o.type === 'Group' || o.type === 'Object3D' || o.type === 'Scene') {
      sceneLines.push(`const ${id} = new THREE.Group();`);
    } else if (LIGHTS[o.type]) {
      const l = /** @type {any} */ (o);
      sceneLines.push(`const ${id} = new THREE.${o.type}(${hex(l.color)}, ${LIGHTS[o.type].map((k) => num(l[k])).join(', ')});`);
      if (l.target) sceneLines.push(`${id}.target.position.set(${args(l.target.position.toArray())}); ${id}.add(${id}.target);`);
      summary.light = (summary.light ?? 0) + 1;
    } else {
      warnings.push(`${o.name || id}: ${o.type} not supported, replaced by an empty Group`);
      sceneLines.push(`const ${id} = new THREE.Group(); // was ${o.type}`);
    }
    sceneLines.push(...transform(o, id));
    if (parent) sceneLines.push(`${parent}.add(${id});`);
    for (const child of o.children) if (child !== /** @type {any} */ (o).target) emit(child, id); // a light's target is emitted with the light
    return id;
  };

  // A glTF scene wrapper with one untransformed child adds nothing: return the child itself,
  // so build → decompile → build does not nest one more Group per round trip.
  const only = scene.children.length === 1 && scene.position.lengthSq() === 0 && scene.quaternion.w === 1 && scene.scale.x === 1 && scene.scale.y === 1 && scene.scale.z === 1;
  const rootId = emit(only ? scene.children[0] : scene, null);

  const kinds = Object.entries(summary).map(([k, v]) => `${k} ×${v}`).join(', ') || 'no meshes';
  const out = [
    `// Generated by meshcode decompile${opts.source ? ` from ${opts.source}` : ''}. Geometry: ${kinds}.`,
    '/** @param {typeof import(\'three\')} THREE */',
    'export default async (THREE) => {',
  ];
  if (textures.length) {
    out.push(
      '  const loader = new THREE.TextureLoader();',
      '  const tex = async (/** @type {string} */ file, /** @type {boolean} */ srgb) => {',
      '    const t = await loader.loadAsync(new URL(file, import.meta.url).href);',
      '    t.flipY = false; // glTF texture convention',
      '    t.wrapS = t.wrapT = THREE.RepeatWrapping;',
      '    if (srgb) t.colorSpace = THREE.SRGBColorSpace;',
      '    return t;',
      '  };',
    );
  }
  if (dataLines.length) {
    out.push(
      '  const b64 = (/** @type {string} */ s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;',
      '  const geometry = (/** @type {any} */ d) => {',
      '    const g = new THREE.BufferGeometry();',
      '    for (const [k, [size, s]] of Object.entries(d.attributes)) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(b64(s)), size));',
      '    if (d.index) g.setIndex(new THREE.BufferAttribute(d.index[0] === \'u32\' ? new Uint32Array(b64(d.index[1])) : new Uint16Array(b64(d.index[1])), 1));',
      '    return g;',
      '  };',
    );
  }
  out.push(...matLines.map((l) => `  ${l}`), ...sceneLines.map((l) => l.split('\n').map((x) => `  ${x}`).join('\n')), `  return ${rootId};`, '};');
  if (dataLines.length) out.push('', '// Vertex data that matched no three.js primitive (base64, float32).', 'const data = {', ...dataLines, '};');
  if (inlineLines.length) out.push('', '// Embedded textures (original encoded bytes).', 'const TEXTURES = {', ...inlineLines, '};');
  return { code: out.join('\n') + '\n', textures: opts.inlineTextures ? [] : textures, summary, warnings };
}
