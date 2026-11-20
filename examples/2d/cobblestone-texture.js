// Seamless cobblestone texture — techniques: Voronoi cells measured on a torus (distances wrap
// around the edges, so the image tiles with no seams), per-stone shading, mortar from the gap
// between nearest and second-nearest cell, and fine grain. Use it with RepeatWrapping on any mesh.
export const size = [256, 256];

/** @param {CanvasRenderingContext2D} ctx @param {{ width: number, height: number }} info */
export default (ctx, { width, height }) => {
  let seed = 9;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // Jittered grid of stone centres (6×6), so stones are even-sized but not aligned.
  const N = 6, cell = width / N;
  const stones = [];
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      stones.push({ x: (gx + 0.2 + rand() * 0.6) * cell, y: (gy + 0.2 + rand() * 0.6) * cell, tone: 0.75 + rand() * 0.35, warm: rand() * 14 });
    }
  }
  // Distance on a torus: the shorter way around in each axis → seamless edges.
  const wrap = (/** @type {number} */ d, /** @type {number} */ span) => Math.min(Math.abs(d), span - Math.abs(d));

  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let d1 = Infinity, d2 = Infinity, nearest = stones[0];
      for (const s of stones) {
        const d = Math.hypot(wrap(x - s.x, width), wrap(y - s.y, height));
        if (d < d1) [d2, d1, nearest] = [d1, d, s];
        else if (d < d2) d2 = d;
      }
      const edge = d2 - d1; // small near the border between two stones
      const mortar = edge < 3.5;
      // Stones are lighter in the middle (rounded look) and carry a little grain.
      const dome = 1 - Math.min(d1 / (cell * 0.75), 1) * 0.35;
      const grain = (rand() - 0.5) * 18;
      const base = mortar ? 46 + grain * 0.5 : (118 * nearest.tone * dome + grain) * Math.min(1, 0.55 + edge / 10);
      const i = (y * width + x) * 4;
      img.data[i] = base + (mortar ? 0 : nearest.warm);
      img.data[i + 1] = base + (mortar ? 0 : nearest.warm * 0.6);
      img.data[i + 2] = base - (mortar ? 0 : 6);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
};
