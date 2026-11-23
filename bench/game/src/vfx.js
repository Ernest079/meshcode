// @ts-check
// Visual effects, in two interchangeable forms over the same geometry and vertex shaders:
//   code  — the fragment shader computes the effect (fireball(), spark() below);
//   files — the fragment shader samples a texture baked from those same functions
//           (an 8×8 flipbook for the explosion, a sprite for particles): the classic artist pipeline.
// bakeFlipbook / bakeSprite render the files form; build.mjs runs them in headless Chrome.
import * as THREE from 'three';

export const FLIPBOOK = { cols: 8, rows: 8, tile: 128 };
const FRAMES = FLIPBOOK.cols * FLIPBOOK.rows;
export const SPARK_LIFE = 0.9;

// p in [-1, 1]², age in [0, 1] → straight-alpha colour.
const FIREBALL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec4 fireball(vec2 p, float age) {
  float grow = 0.35 + 0.6 * sqrt(age);
  float n = fbm(p * 2.5 + vec2(0.0, -age * 1.5));
  float d = length(p) / grow + (n - 0.5) * 0.6;
  float heat = clamp(1.0 - d - age * 0.8, 0.0, 1.0);
  vec3 col = mix(vec3(0.25, 0.22, 0.2), vec3(1.0, 0.45, 0.08), smoothstep(0.0, 0.35, heat));
  col = mix(col, vec3(1.0, 0.95, 0.7), smoothstep(0.35, 0.8, heat));
  return vec4(col, smoothstep(1.0, 0.2, d) * (1.0 - smoothstep(0.55, 1.0, age)));
}`;

// pc = gl_PointCoord → straight-alpha colour of a soft, hot particle.
const SPARK = /* glsl */ `
vec4 spark(vec2 pc) {
  float a = pow(clamp(1.0 - length(pc - 0.5) * 2.0, 0.0, 1.0), 2.0);
  return vec4(mix(vec3(1.0, 0.5, 0.1), vec3(1.0, 0.95, 0.75), a), a);
}`;

// Billboard per instance: centre from instanceMatrix, size from its scale, per-instance age and spin.
const BILLBOARD_VS = /* glsl */ `
attribute float aAge;
attribute float aRot;
varying vec2 vUv;
varying float vAge;
void main() {
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float c = cos(aRot), s = sin(aRot);
  center.xy += mat2(c, s, -s, c) * position.xy * length(instanceMatrix[0].xyz);
  gl_Position = projectionMatrix * center;
  vUv = uv;
  vAge = aAge;
}`;

// Particles: sparks fly ballistically from their birth; DUST drifts forever (no birth, no fade).
const PARTICLES_VS = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec3 aVel;
attribute float aBirth;
attribute float aSize;
varying float vFade;
void main() {
#ifdef DUST
  vec3 p = position;
  p.y = mod(position.y + uTime * 0.25, 6.0);
  p.x += sin(uTime * 0.5 + position.z) * 0.4;
  vFade = 0.35;
  float alive = 1.0;
#else
  float age = uTime - aBirth;
  vec3 p = position + aVel * age + vec3(0.0, -4.9, 0.0) * age * age;
  vFade = 1.0 - clamp(age / ${SPARK_LIFE.toFixed(2)}, 0.0, 1.0);
  float alive = step(0.0, age) * step(age, ${SPARK_LIFE.toFixed(2)});
#endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = alive * aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const premultiply = 'gl_FragColor = vec4(c.rgb * c.a, c.a);';
const blending = /** @type {const} */ ({
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});

/** Explosion billboards: procedural (sheet = null) or flipbook. @param {THREE.Texture | null} sheet */
export function explosionMaterial(sheet) {
  const fragmentShader = sheet
    ? /* glsl */ `uniform sampler2D uSheet;
varying vec2 vUv;
varying float vAge;
void main() {
  float f = min(floor(vAge * ${FRAMES}.0), ${FRAMES - 1}.0);
  vec2 tile = vec2(mod(f, ${FLIPBOOK.cols}.0), floor(f / ${FLIPBOOK.cols}.0));
  vec4 c = texture2D(uSheet, (tile + vec2(vUv.x, 1.0 - vUv.y)) / vec2(${FLIPBOOK.cols}.0, ${FLIPBOOK.rows}.0));
  ${premultiply}
}`
    : /* glsl */ `${FIREBALL}
varying vec2 vUv;
varying float vAge;
void main() {
  vec4 c = fireball(vUv * 2.0 - 1.0, vAge);
  ${premultiply}
}`;
  return new THREE.ShaderMaterial({ name: 'explosion', vertexShader: BILLBOARD_VS, fragmentShader, uniforms: { uSheet: { value: sheet } }, ...blending });
}

/** Sparks or dust: procedural (sprite = null) or a sprite texture. @param {THREE.Texture | null} sprite @param {boolean} dust */
export function particleMaterial(sprite, dust) {
  const fragmentShader = sprite
    ? /* glsl */ `uniform sampler2D uSprite;
varying float vFade;
void main() {
  vec4 c = texture2D(uSprite, gl_PointCoord);
  c.a *= vFade;
  ${premultiply}
}`
    : /* glsl */ `${SPARK}
varying float vFade;
void main() {
  vec4 c = spark(gl_PointCoord);
  c.a *= vFade;
  ${premultiply}
}`;
  return new THREE.ShaderMaterial({
    name: dust ? 'dust' : 'sparks', vertexShader: PARTICLES_VS, fragmentShader, defines: dust ? { DUST: '' } : {},
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uSprite: { value: sprite } }, ...blending,
  });
}

/** Texture settings for the baked files (flipY off: row 0 of the image is the top row of tiles). @param {THREE.Texture} t */
export function bakedTexture(t) {
  t.flipY = false;
  t.generateMipmaps = false; // mipmaps would bleed between flipbook tiles
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; // shader output is written as is, so the texels must be too
  t.needsUpdate = true;
  return t;
}

/**
 * Render a fragment body into tiles of a straight-alpha canvas (the files form of the effects).
 * @param {string} glsl function definitions @param {string} body sets `vec4 c` from `vUv` and `uAge`
 * @param {number} cols @param {number} rows @param {number} tile @param {(i: number) => number} ageOf
 */
function bake(glsl, body, cols, rows, tile, ageOf) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(cols * tile, rows * tile, false);
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  const material = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${glsl}\nuniform float uAge;\nvarying vec2 vUv;\nvoid main() { ${body} gl_FragColor = c; }`,
    uniforms: { uAge: { value: 0 } }, blending: THREE.NoBlending, depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const camera = new THREE.Camera();
  for (let i = 0; i < cols * rows; i++) {
    material.uniforms.uAge.value = ageOf(i);
    const col = i % cols, row = Math.floor(i / cols);
    renderer.setViewport(col * tile, (rows - 1 - row) * tile, tile, tile); // GL origin is bottom-left
    renderer.render(quad, camera);
  }
  return renderer;
}

/** The explosion flipbook: frame i shows the fireball at the middle of its age interval. */
export const bakeFlipbook = () =>
  bake(FIREBALL, 'vec4 c = fireball(vUv * 2.0 - 1.0, uAge);', FLIPBOOK.cols, FLIPBOOK.rows, FLIPBOOK.tile, (i) => (i + 0.5) / FRAMES);

/** The particle sprite (64²; gl_PointCoord's y points down, the sprite is symmetric anyway). */
export const bakeSprite = () => bake(SPARK, 'vec4 c = spark(vec2(vUv.x, 1.0 - vUv.y));', 1, 1, 64, () => 0);
