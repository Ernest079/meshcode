// Parallax background — techniques: each "frame" is one LAYER (sky, far mountains, near hills),
// stacked vertically (columns = 1). Ridges are sums of sines whose periods divide the width,
// so every layer scrolls seamlessly; layers 1–2 are transparent above the ridge.
// In a game, scroll layer 0 slowest and layer 2 fastest.
export const size = [512, 192];
export const frames = 3;
export const columns = 1;
export const fps = 1; // the preview steps through the layers slowly

/** @param {CanvasRenderingContext2D} ctx @param {{ width: number, height: number, frame: number }} info */
export default (ctx, { width: W, height: H, frame: layer }) => {
  // Periodic ridge: integer cycles per width → left edge matches right edge.
  const ridge = (/** @type {number[][]} */ waves, /** @type {number} */ base) => (/** @type {number} */ x) =>
    base + waves.reduce((y, [cycles, amp, phase]) => y + amp * Math.sin((x / W) * Math.PI * 2 * cycles + phase), 0);
  const fillRidge = (/** @type {(x: number) => number} */ f, /** @type {string | CanvasGradient} */ style) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 2) ctx.lineTo(x, f(x));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };

  if (layer === 0) {
    // Sky: dusk gradient, a low sun with a soft halo, and a few stars.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b1f4b');
    sky.addColorStop(0.55, '#7a3e74');
    sky.addColorStop(1, '#f0915a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const halo = ctx.createRadialGradient(W * 0.7, H * 0.78, 4, W * 0.7, H * 0.78, 90);
    halo.addColorStop(0, 'rgba(255,214,140,0.95)');
    halo.addColorStop(0.25, 'rgba(255,180,110,0.45)');
    halo.addColorStop(1, 'rgba(255,160,100,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    let seed = 21;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
      ctx.fillRect(rand() * W, rand() * H * 0.45, 1 + (rand() < 0.15 ? 1 : 0), 1);
    }
  } else if (layer === 1) {
    // Far mountains: tall, hazy purple, two overlapping ranges.
    fillRidge(ridge([[2, 22, 0.3], [5, 10, 1.7], [11, 4, 0.2]], H * 0.5), '#5a3a6e');
    fillRidge(ridge([[3, 16, 2.1], [7, 7, 0.9], [13, 3, 2.5]], H * 0.64), '#4a2f5c');
  } else {
    // Near hills with pine silhouettes standing on the ridge line.
    const hill = ridge([[1, 10, 1.1], [3, 8, 0.4], [6, 3, 2.2]], H * 0.76);
    const shade = ctx.createLinearGradient(0, H * 0.6, 0, H);
    shade.addColorStop(0, '#2c2440');
    shade.addColorStop(1, '#17122a');
    fillRidge(hill, shade);
    ctx.fillStyle = '#17122a';
    for (let x = 6; x < W; x += 23 + ((x * 7) % 17)) {
      const h = 18 + ((x * 13) % 22), y = hill(x) + 3;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.32, y);
      ctx.lineTo(x - h * 0.32, y);
      ctx.closePath();
      ctx.fill();
    }
  }
};
