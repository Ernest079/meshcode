// Pixel-art walk cycle — techniques: draw at 16×16 "art pixels", add a 1-px outline by scanning
// the alpha channel, then scale ×4 with smoothing OFF. 8 frames → a 512×64 sprite sheet
// (Godot: AnimatedSprite2D / hframes = 8 · Unity: Sprite Editor → Grid By Cell Count 8×1).
export const size = [64, 64];
export const frames = 8;
export const fps = 10;

const ART = 16;
const C = {
  outline: '#1d1b2a', skin: '#f2c79b', hair: '#8a4b2a', eye: '#1d1b2a',
  hat: '#3f9d4e', hatShade: '#2b7037', feather: '#f2c14e',
  tunic: '#3a6fd8', tunicShade: '#2a4f9e', belt: '#6b3f1f', buckle: '#f2c14e',
  pants: '#5b4a3a', boots: '#4a2f1b', backArm: '#2a4f9e',
};

/** @param {CanvasRenderingContext2D} ctx @param {{ width: number, height: number, frame: number, frames: number }} info */
export default (ctx, { width, frame, frames }) => {
  const art = Object.assign(document.createElement('canvas'), { width: ART, height: ART });
  const a = /** @type {CanvasRenderingContext2D} */ (art.getContext('2d'));
  const px = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h, /** @type {string} */ color) => {
    a.fillStyle = color;
    a.fillRect(x, y, w, h);
  };

  // Walk phase: legs and arms swing in opposite directions; the body dips at full stride.
  const t = (frame / frames) * Math.PI * 2;
  const swing = Math.round(Math.sin(t) * 2); // −2..2 art pixels
  const dip = Math.abs(Math.sin(t)) > 0.7 ? 1 : 0;

  // Back leg and back arm first (behind the body), in darker tones.
  px(7 - swing, 12, 2, 2, C.pants);
  px(7 - swing, 14, 2, 1, C.boots);
  px(5, 8 + dip, 1, 3, C.backArm);
  px(5 - Math.sign(swing), 10 + dip, 1, 1, C.skin);
  // Front leg.
  px(7 + swing, 12, 2, 2, C.pants);
  px(7 + swing, 14, 2, 1, C.boots);
  px(8 + swing, 14, 2, 1, C.boots); // toe points forward (right)

  const y = dip; // everything above the legs bobs together
  // Tunic with a shaded back half, belt and buckle.
  px(6, 8 + y, 5, 4, C.tunic);
  px(6, 8 + y, 1, 4, C.tunicShade);
  px(6, 10 + y, 5, 1, C.belt);
  px(9, 10 + y, 1, 1, C.buckle);
  // Head: skin, hair at the back, one eye looking right.
  px(6, 4 + y, 5, 4, C.skin);
  px(6, 4 + y, 2, 3, C.hair);
  px(9, 5 + y, 1, 1, C.eye);
  // Pointed hat leaning back, with a feather.
  px(5, 3 + y, 7, 1, C.hatShade);
  px(6, 2 + y, 5, 1, C.hat);
  px(5, 1 + y, 4, 1, C.hat);
  px(4, 0 + y, 2, 1, C.hat);
  px(9, 1 + y, 2, 1, C.feather);
  // Front arm swings against the front leg.
  px(10, 8 + y, 1, 3, C.tunic);
  px(10 + Math.sign(swing), 10 + y, 1, 1, C.skin);

  // Outline: any empty pixel touching a filled one becomes outline colour.
  const img = a.getImageData(0, 0, ART, ART);
  const filled = (/** @type {number} */ x, /** @type {number} */ yy) => x >= 0 && yy >= 0 && x < ART && yy < ART && img.data[(yy * ART + x) * 4 + 3] > 0;
  a.fillStyle = C.outline;
  for (let yy = 0; yy < ART; yy++) {
    for (let x = 0; x < ART; x++) {
      if (!filled(x, yy) && (filled(x - 1, yy) || filled(x + 1, yy) || filled(x, yy - 1) || filled(x, yy + 1))) a.fillRect(x, yy, 1, 1);
    }
  }

  ctx.imageSmoothingEnabled = false; // crisp pixels when scaling up
  ctx.drawImage(art, 0, 0, width, width);
};
