// @ts-check
// Stateless 2D rigging & easing helpers injected into 2D canvas modules ({ ease, rig }).
// Every function is pure and deterministic from its inputs (t / u), so live rAF preview
// and discrete sprite-sheet baking always produce identical poses.

/** @param {number} v @param {number} [min] @param {number} [max] */
export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);

/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wrap normalized loop progress u shifted by delay into [0, 1) for seamless follow-through. @param {number} u @param {number} [delay] */
export const phase = (u, delay = 0) => (((u - delay) % 1) + 1) % 1;

/** Triangle wave on [0, 1): 0 → 1 → 0. @param {number} u */
export const pingpong = (u) => 1 - Math.abs(2 * phase(u) - 1);

/** Map v from [inMin, inMax] to [outMin, outMax] (clamped by default). @param {number} v @param {number} inMin @param {number} inMax @param {number} [outMin] @param {number} [outMax] @param {boolean} [doClamp] */
export const remap = (v, inMin, inMax, outMin = 0, outMax = 1, doClamp = true) => {
  if (inMax === inMin) return outMin;
  const k = (v - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, doClamp ? clamp(k, 0, 1) : k);
};

/**
 * Closed-form damped harmonic oscillator moving from 0 to 1 at elapsed time t >= 0 (seconds).
 * Purely analytical (stateless): identical results at any t regardless of frame rate.
 * @param {number} t seconds since impulse
 * @param {{ stiffness?: number, damping?: number, mass?: number, velocity?: number }} [opts]
 */
export function spring(t, { stiffness = 180, damping = 12, mass = 1, velocity = 0 } = {}) {
  if (t <= 0) return 0;
  const k = Math.max(1e-6, stiffness);
  const m = Math.max(1e-6, mass);
  const c = Math.max(0, damping);
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const y0 = 1;
  const v0 = -velocity;
  if (zeta < 1 - 1e-6) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * w0 * t);
    return 1 - env * (y0 * Math.cos(wd * t) + ((v0 + zeta * w0 * y0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1 + 1e-6) {
    const env = Math.exp(-w0 * t);
    return 1 - env * (y0 + (v0 + w0 * y0) * t);
  }
  const r = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + r;
  const r2 = -zeta * w0 - r;
  const c1 = (v0 - r2 * y0) / (r1 - r2);
  const c2 = y0 - c1;
  return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}

export const ease = Object.freeze({
  /** @param {number} u */
  linear: (u) => u,
  /** @param {number} u */
  inQuad: (u) => u * u,
  /** @param {number} u */
  outQuad: (u) => 1 - (1 - u) * (1 - u),
  /** @param {number} u */
  inOutQuad: (u) => (u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2),
  /** @param {number} u */
  inCubic: (u) => u * u * u,
  /** @param {number} u */
  outCubic: (u) => 1 - (1 - u) ** 3,
  /** @param {number} u */
  inOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2),
  /** @param {number} u @param {number} [s] */
  inBack: (u, s = 1.70158) => (s + 1) * u * u * u - s * u * u,
  /** @param {number} u @param {number} [s] */
  outBack: (u, s = 1.70158) => 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2,
  /** @param {number} u @param {number} [s] */
  inOutBack: (u, s = 1.70158) => {
    const c = s * 1.525;
    return u < 0.5
      ? (((2 * u) ** 2) * ((c + 1) * 2 * u - c)) / 2
      : (((2 * u - 2) ** 2) * ((c + 1) * (u * 2 - 2) + c) + 2) / 2;
  },
  /** @param {number} u @param {number} [amp] @param {number} [period] */
  outElastic: (u, amp = 1, period = 0.3) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const a = Math.max(1, amp);
    const s = (period / (2 * Math.PI)) * Math.asin(1 / a);
    return a * 2 ** (-10 * u) * Math.sin(((u - s) * 2 * Math.PI) / period) + 1;
  },
  /** @param {number} u */
  outBounce: (u) => {
    const n1 = 7.5625, d1 = 2.75;
    if (u < 1 / d1) return n1 * u * u;
    if (u < 2 / d1) { const t = u - 1.5 / d1; return n1 * t * t + 0.75; }
    if (u < 2.5 / d1) { const t = u - 2.25 / d1; return n1 * t * t + 0.9375; }
    const t = u - 2.625 / d1;
    return n1 * t * t + 0.984375;
  },
  spring,
});

/**
 * Push a local transform pivot onto ctx, apply optional volume-preserving squash & stretch
 * (scaleX = sx / squash, scaleY = sy * squash), invoke drawFn(ctx), and always restore ctx.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x?: number, y?: number, rot?: number, sx?: number, sy?: number, squash?: number, alpha?: number }} [opts]
 * @param {(ctx: CanvasRenderingContext2D) => void} [drawFn]
 */
export function node(ctx, opts, drawFn) {
  const fn = typeof opts === 'function' ? opts : drawFn;
  const o = typeof opts === 'function' ? {} : (opts ?? {});
  const { x = 0, y = 0, rot = 0, sx = 1, sy = 1, squash = 1, alpha } = o;
  ctx.save();
  try {
    if (x || y) ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    const sq = squash || 1;
    const scaleX = sx / sq;
    const scaleY = sy * sq;
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    fn?.(ctx);
  } finally {
    ctx.restore();
  }
}

export const rig = Object.freeze({
  node,
  phase,
  pingpong,
  lerp,
  clamp,
  remap,
});
