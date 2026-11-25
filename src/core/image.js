// @ts-check
// Browser core for 2D: images and rigged animations from code. The source kind is detected from the text:
//   canvas — JS module: export default (ctx, { width, height, frame, frames, fps, duration, t, u, clip, ease, rig }) => { … }
//            optional exports: size = [w, h], frames = N, duration = sec, columns, fps, smooth = true|false,
//            clips = { idle: { duration, fps, frames, columns, loop }, … }
//   svg    — SVG markup
//   html   — HTML + <style>, rendered through an SVG <foreignObject>
//            (works in Chromium and Firefox; Safari taints the canvas, so export fails there)
// Markup size: width/height (or viewBox) on <svg>, or a comment such as <!-- size: 512x256 -->.
import { ease, rig } from './rig2d.js';

const MAX_SIDE = 8192; // keeps a typo like size = [50000, 50000] from eating the tab's memory

/** @typedef {'canvas' | 'svg' | 'html'} ImageKind */
/** @typedef {{ name: string | null, frames: number, columns: number, fps: number, duration: number, loop: boolean, sheetWidth: number, sheetHeight: number }} ClipSpec */
/** @typedef {{ kind: ImageKind, canvas: HTMLCanvasElement, width: number, height: number, frames: number, columns: number, fps: number, duration: number, smooth: boolean | null, clip: string | null, clips: string[] }} RenderedImage */
/** @typedef {{
 *   kind: ImageKind, width: number, height: number, smooth: boolean | null,
 *   clipNames: string[], defaultClip: string | null,
 *   getClip: (clipName?: string | null) => ClipSpec,
 *   renderFrame: (ctx: CanvasRenderingContext2D, state?: { clip?: string | null, frame?: number, t?: number, u?: number }) => Promise<void>,
 *   bakeSheet: (clipName?: string | null) => Promise<RenderedImage>,
 * }} LoadedImageSource */

/** @param {string} code @returns {ImageKind} */
export function detectKind(code) {
  const head = code.replace(/^(\s*(<\?xml[^>]*>|<!--[\s\S]*?-->|<!doctype[^>]*>))*\s*/i, '');
  if (/^<svg[\s>]/i.test(head)) return 'svg';
  if (head.startsWith('<')) return 'html';
  return 'canvas';
}

/** @param {number} w @param {number} h */
function checkSize(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
    throw new RangeError(`image size must be whole numbers between 1 and ${MAX_SIDE}, got ${w}×${h}`);
  }
}

/** @param {number} w @param {number} h */
function makeCanvas(w, h) {
  checkSize(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
const ctx2d = (/** @type {HTMLCanvasElement} */ c) => /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));

/** Import JS source as a module (blob URL: works inside the sandboxed frame and in the CLI page). @param {string} code */
async function importSource(code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } catch (err) {
    const e = /** @type {Error} */ (err);
    if (/resolve module specifier/i.test(e.message)) e.message += ' — imports are not available here: use the ease and rig arguments';
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resolve one clip's frame count, fps, duration and sheet grid layout.
 * @param {string | null} name
 * @param {any} spec
 * @param {any} mod
 * @param {number} width
 * @param {number} height
 * @returns {ClipSpec}
 */
function resolveClipSpec(name, spec, mod, width, height) {
  const label = name ? `clip "${name}"` : 'module';
  const rawFps = spec.fps ?? mod.fps;
  const rawDuration = spec.duration ?? (name ? undefined : mod.duration);
  const rawFrames = spec.frames ?? (name ? undefined : mod.frames);
  const fps = rawFps ?? (rawDuration !== undefined ? 24 : 8);
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0 || fps > 120) {
    throw new RangeError(`${label}: \`fps\` must be a number between 0 and 120, got ${fps}`);
  }
  if (rawDuration !== undefined && (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration <= 0 || rawDuration > 600)) {
    throw new RangeError(`${label}: \`duration\` must be between 0 and 600 seconds, got ${rawDuration}`);
  }
  const frames = rawFrames ?? (rawDuration !== undefined ? Math.max(1, Math.round(rawDuration * fps)) : (mod.frames ?? 1));
  if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames and columns must be positive integers');
  const duration = rawDuration ?? (frames > 1 ? frames / fps : 0);
  const explicitCols = spec.columns ?? mod.columns;
  let columns;
  if (explicitCols !== undefined) {
    if (!Number.isInteger(explicitCols) || explicitCols < 1) throw new RangeError('frames and columns must be positive integers');
    columns = Math.min(frames, explicitCols);
  } else if (width * frames <= MAX_SIDE) {
    columns = frames;
  } else {
    const maxCols = Math.max(1, Math.floor(MAX_SIDE / width));
    const gridCols = Math.min(frames, maxCols, Math.ceil(Math.sqrt(frames)));
    columns = Math.ceil(frames / gridCols) * height <= MAX_SIDE ? gridCols : Math.min(frames, maxCols);
  }
  const sheetWidth = width * columns;
  const sheetHeight = height * Math.ceil(frames / columns);
  checkSize(sheetWidth, sheetHeight);
  const loop = spec.loop ?? mod.loop ?? true;
  return { name, frames, columns, fps, duration, loop: !!loop, sheetWidth, sheetHeight };
}

/**
 * Validate a canvas module and return a handle that can render live frames or bake sprite sheets.
 * @param {any} mod
 * @returns {LoadedImageSource}
 */
function loadCanvasModule(mod) {
  if (typeof mod.default !== 'function') throw new TypeError('2D module must `export default (ctx, { width, height, frame, frames }) => {}`');
  const [width, height] = mod.size ?? [512, 512];
  checkSize(width, height);
  if (mod.smooth !== undefined && typeof mod.smooth !== 'boolean') throw new TypeError('`smooth` must be true or false');
  const smooth = mod.smooth ?? null;

  /** @type {Map<string | null, ClipSpec>} */
  const clipMap = new Map();
  /** @type {string[]} */
  let clipNames = [];
  /** @type {string | null} */
  let defaultClip = null;

  if (mod.clips !== undefined) {
    if (!mod.clips || typeof mod.clips !== 'object' || Array.isArray(mod.clips)) {
      throw new TypeError('`clips` must be an object mapping clip names to `{ duration, fps, frames, columns, loop }`');
    }
    clipNames = Object.keys(mod.clips);
    if (!clipNames.length) throw new RangeError('`clips` must define at least one clip');
    defaultClip = clipNames[0];
    for (const name of clipNames) {
      const spec = mod.clips[name];
      if (!spec || typeof spec !== 'object') throw new TypeError(`clip "${name}" must be an object`);
      clipMap.set(name, resolveClipSpec(name, spec, mod, width, height));
    }
  } else {
    clipMap.set(null, resolveClipSpec(null, {}, mod, width, height));
  }

  /** @param {string | null} [clipName] @returns {ClipSpec} */
  const getClip = (clipName) => {
    const key = clipName ?? defaultClip;
    const spec = clipMap.get(key);
    if (!spec) {
      const avail = clipNames.length ? ` (available: ${clipNames.join(', ')})` : ' (this module does not define `clips`)';
      throw new RangeError(`unknown clip "${clipName}"${avail}`);
    }
    return spec;
  };

  /** @type {LoadedImageSource['renderFrame']} */
  const renderFrame = async (ctx, state = {}) => {
    const spec = getClip(state.clip);
    const { frames, fps, duration } = spec;
    let u, t, frame;
    if (state.t !== undefined) {
      t = state.t;
      u = duration > 0 ? t / duration : 0;
      frame = Math.min(frames - 1, Math.max(0, Math.floor(u * frames)));
    } else if (state.u !== undefined) {
      u = state.u;
      t = u * duration;
      frame = Math.min(frames - 1, Math.max(0, Math.floor(u * frames)));
    } else {
      frame = state.frame ?? 0;
      u = frames > 1 ? frame / frames : 0;
      t = u * duration;
    }
    await mod.default(ctx, { width, height, frame, frames, fps, duration, t, u, clip: spec.name, ease, rig });
  };

  /** @param {string | null} [clipName] @returns {Promise<RenderedImage>} */
  const bakeSheet = async (clipName) => {
    const spec = getClip(clipName);
    const { frames, columns, fps, duration, sheetWidth, sheetHeight } = spec;
    const sheet = makeCanvas(sheetWidth, sheetHeight);
    const sheetCtx = ctx2d(sheet);
    for (let frame = 0; frame < frames; frame++) {
      const c = makeCanvas(width, height);
      await renderFrame(ctx2d(c), { clip: spec.name, frame });
      sheetCtx.drawImage(c, (frame % columns) * width, Math.floor(frame / columns) * height);
    }
    return { kind: 'canvas', canvas: sheet, width, height, frames, columns, fps, duration, smooth, clip: spec.name, clips: clipNames };
  };

  return { kind: 'canvas', width, height, smooth, clipNames, defaultClip, getClip, renderFrame, bakeSheet };
}

/** @param {string} code @param {ImageKind} kind @returns {[number, number]} */
function markupSize(code, kind) {
  const hint = code.match(/<!--\s*size:\s*(\d+)\s*[x×]\s*(\d+)\s*-->/i);
  if (hint) return [Number(hint[1]), Number(hint[2])];
  if (kind === 'svg') {
    const svg = new DOMParser().parseFromString(code, 'image/svg+xml').documentElement;
    const w = parseFloat(svg.getAttribute('width') ?? ''), h = parseFloat(svg.getAttribute('height') ?? '');
    if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
    const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    if (box.length === 4 && box[2] > 0 && box[3] > 0) return [Math.round(box[2]), Math.round(box[3])];
  }
  return [512, 512];
}

/** SVG or HTML markup → canvas, through an <img> of an SVG document. @param {string} code @param {ImageKind} kind */
async function renderMarkup(code, kind) {
  const [width, height] = markupSize(code, kind);
  let svg;
  if (kind === 'svg') {
    const doc = new DOMParser().parseFromString(code, 'image/svg+xml');
    const error = doc.querySelector('parsererror');
    if (error) throw new SyntaxError(`invalid SVG: ${(error.textContent ?? '').trim().split('\n')[0]}`);
    doc.documentElement.setAttribute('width', String(width));
    doc.documentElement.setAttribute('height', String(height));
    svg = new XMLSerializer().serializeToString(doc);
  } else {
    // Parse as forgiving HTML, then re-serialize as XHTML so it is valid inside SVG (<br> → <br />, &nbsp; → &#160;).
    const doc = new DOMParser().parseFromString(code, 'text/html');
    const root = doc.createElement('div');
    root.setAttribute('style', `width:${width}px;height:${height}px;overflow:hidden`);
    root.append(...doc.head.querySelectorAll('style'), ...doc.body.childNodes);
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(root)}</foreignObject></svg>`;
  }
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
  } catch {
    throw new Error(`could not render ${kind.toUpperCase()} (external images and fonts must be embedded as data: URLs)`);
  }
  const canvas = makeCanvas(width, height);
  ctx2d(canvas).drawImage(img, 0, 0, width, height);
  return { kind, canvas, width, height, frames: 1, columns: 1, fps: 0, duration: 0, smooth: null, clip: null, clips: /** @type {string[]} */ ([]) };
}

/**
 * Load 2D source code into an executable handle (supports live frame rendering and on-demand sheet baking).
 * @param {string} code
 * @returns {Promise<LoadedImageSource>}
 */
export async function loadImageSource(code) {
  const kind = detectKind(code);
  if (kind === 'canvas') return loadCanvasModule(await importSource(code));
  const rendered = await renderMarkup(code, kind);
  const spec = { name: null, frames: 1, columns: 1, fps: 0, duration: 0, loop: false, sheetWidth: rendered.width, sheetHeight: rendered.height };
  return {
    kind,
    width: rendered.width,
    height: rendered.height,
    smooth: null,
    clipNames: [],
    defaultClip: null,
    getClip: (clipName) => {
      if (clipName) throw new RangeError(`unknown clip "${clipName}" (only canvas modules support \`clips\`)`);
      return spec;
    },
    renderFrame: async (ctx) => { ctx.drawImage(rendered.canvas, 0, 0); },
    bakeSheet: async (clipName) => {
      if (clipName) throw new RangeError(`unknown clip "${clipName}" (only canvas modules support \`clips\`)`);
      return rendered;
    },
  };
}

/**
 * Render 2D source code of any kind into a baked canvas (single image or sprite sheet).
 * @param {string} code
 * @param {{ clip?: string | null }} [opts]
 * @returns {Promise<RenderedImage>}
 */
export async function renderImage(code, opts = {}) {
  const src = await loadImageSource(code);
  return src.bakeSheet(opts.clip);
}

/**
 * Encode a canvas. JPEG has no alpha, so transparent areas are flattened onto white.
 * @param {HTMLCanvasElement} canvas @param {'image/png' | 'image/jpeg' | 'image/webp'} type @param {number} [quality]
 * @returns {Promise<ArrayBuffer>}
 */
export async function encodeImage(canvas, type = 'image/png', quality = 0.92) {
  let source = canvas;
  if (type === 'image/jpeg') {
    source = makeCanvas(canvas.width, canvas.height);
    const ctx = ctx2d(source);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
  }
  const blob = await new Promise((resolve, reject) =>
    source.toBlob((b) => (b ? resolve(b) : reject(new Error(`could not encode ${type}`))), type, quality));
  // toBlob silently falls back to PNG for unsupported types.
  if (blob.type !== type) throw new Error(`${type} is not supported by this browser`);
  return blob.arrayBuffer();
}

/** Fraction of pixels that are not fully transparent (0..1). @param {HTMLCanvasElement} canvas */
export function coverage(canvas) {
  const data = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
  return n / (canvas.width * canvas.height);
}
