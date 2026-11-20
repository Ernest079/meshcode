// @ts-check
// Browser core for 2D: images from code. The source kind is detected from the text:
//   canvas — JS module: export default (ctx, { width, height, frame, frames }) => { … }
//            optional exports: size = [w, h], frames = N (sprite sheet), columns, fps
//   svg    — SVG markup
//   html   — HTML + <style>, rendered through an SVG <foreignObject>
//            (works in Chromium and Firefox; Safari taints the canvas, so export fails there)
// Markup size: width/height (or viewBox) on <svg>, or a comment such as <!-- size: 512x256 -->.

const MAX_SIDE = 8192; // keeps a typo like size = [50000, 50000] from eating the tab's memory

/** @typedef {'canvas' | 'svg' | 'html'} ImageKind */
/** @typedef {{ kind: ImageKind, canvas: HTMLCanvasElement, width: number, height: number, frames: number, columns: number, fps: number }} RenderedImage */

/** @param {string} code @returns {ImageKind} */
export function detectKind(code) {
  const head = code.replace(/^(\s*(<\?xml[^>]*>|<!--[\s\S]*?-->|<!doctype[^>]*>))*\s*/i, '');
  if (/^<svg[\s>]/i.test(head)) return 'svg';
  if (head.startsWith('<')) return 'html';
  return 'canvas';
}

/** @param {number} w @param {number} h */
function makeCanvas(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
    throw new RangeError(`image size must be whole numbers between 1 and ${MAX_SIDE}, got ${w}×${h}`);
  }
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
const ctx2d = (/** @type {HTMLCanvasElement} */ c) => /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));

/** Import JS source as a module (blob URL: works inside the sandboxed frame and in the CLI page). @param {string} code */
async function importSource(code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Run a canvas module once per frame and lay the frames out as a sheet (left→right, then down). @param {any} mod */
async function renderCanvasModule(mod) {
  if (typeof mod.default !== 'function') throw new TypeError('2D module must `export default (ctx, { width, height, frame, frames }) => {}`');
  const [width, height] = mod.size ?? [512, 512];
  const frames = mod.frames ?? 1;
  const columns = Math.min(frames, mod.columns ?? frames);
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(columns) || columns < 1) throw new RangeError('frames and columns must be positive integers');
  const sheet = makeCanvas(width * columns, height * Math.ceil(frames / columns));
  for (let frame = 0; frame < frames; frame++) {
    const c = makeCanvas(width, height);
    await mod.default(ctx2d(c), { width, height, frame, frames });
    ctx2d(sheet).drawImage(c, (frame % columns) * width, Math.floor(frame / columns) * height);
  }
  return { canvas: sheet, width, height, frames, columns, fps: mod.fps ?? 8 };
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
  return { canvas, width, height, frames: 1, columns: 1, fps: 0 };
}

/**
 * Render 2D source code of any kind.
 * @param {string} code
 * @returns {Promise<RenderedImage>}
 */
export async function renderImage(code) {
  const kind = detectKind(code);
  const r = kind === 'canvas' ? await renderCanvasModule(await importSource(code)) : await renderMarkup(code, kind);
  return { kind, ...r };
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
