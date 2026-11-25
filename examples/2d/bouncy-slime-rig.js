// Bouncy slime 2D vector rig — lineless geometric demo of hierarchical pivots (rig.node),
// volume-preserving squash & stretch, follow-through delay (rig.phase), analytical spring,
// facial expression swaps, and 3 reusable clips (idle, jump, happy).
export const size = [256, 256];
export const smooth = true;
export const clips = {
  idle:  { duration: 1.8, fps: 24, loop: true },
  jump:  { duration: 1.1, fps: 24, loop: true },
  happy: { duration: 1.0, fps: 24, loop: true },
};

const PAL = {
  body:      '#4CD4A9',
  bodyShade: '#28A684',
  highlight: '#A9F5DC',
  leaf:      '#67C74F',
  leafShade: '#3E9638',
  blush:     '#FF94A8',
  ink:       '#1A2E35',
  mouth:     '#223E47',
  tongue:    '#FF6B8B',
  white:     '#FFFFFF',
};

/** Rounded jelly dome anchored at the bottom center (0, 0). @param {CanvasRenderingContext2D} ctx */
function drawBody(ctx) {
  // Main plump silhouette
  ctx.fillStyle = PAL.body;
  ctx.beginPath();
  ctx.moveTo(-66, -6);
  ctx.bezierCurveTo(-72, -62, -46, -108, 0, -108);
  ctx.bezierCurveTo(46, -108, 72, -62, 66, -6);
  ctx.quadraticCurveTo(64, 4, 0, 4);
  ctx.quadraticCurveTo(-64, 4, -66, -6);
  ctx.closePath();
  ctx.fill();

  // Clip interior shading & specular sheen to the body contour
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PAL.bodyShade;
  ctx.beginPath();
  ctx.ellipse(4, 14, 78, 30, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = PAL.highlight;
  ctx.beginPath();
  ctx.ellipse(-28, -76, 17, 9, -0.55, 0, Math.PI * 2);
  ctx.ellipse(-44, -56, 6, 4.5, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Two-leaf sprout pivoted at its stem base (0, 0). @param {CanvasRenderingContext2D} ctx @param {number} spread */
function drawSprout(ctx, spread) {
  // Stem
  ctx.strokeStyle = PAL.leafShade;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.quadraticCurveTo(-2, -12, 0, -24);
  ctx.stroke();

  const leaf = (/** @type {number} */ side) => {
    ctx.save();
    ctx.translate(0, -22);
    ctx.rotate(side * (0.68 + spread * 0.28));
    ctx.fillStyle = side < 0 ? PAL.leaf : PAL.leafShade;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(side * 12, -16, side * 32, -14, side * 34, 0);
    ctx.bezierCurveTo(side * 24, 10, side * 8, 8, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  leaf(-1);
  leaf(1);
}

/** Expressive face centered at (0, 0). @param {CanvasRenderingContext2D} ctx @param {{ happy: boolean, blink: number, lookX: number, lookY: number }} f */
function drawFace(ctx, { happy, blink, lookX, lookY }) {
  // Rosy cheeks
  ctx.fillStyle = PAL.blush;
  ctx.beginPath();
  ctx.ellipse(-34, 12, 10, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(34, 12, 10, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  for (const ex of [-20, 20]) {
    if (happy) {
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, 4, 10, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (blink > 0.78) {
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 9, 0);
      ctx.quadraticCurveTo(ex, 6, ex + 9, 0);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(ex, 0);
      ctx.scale(1, 1 - blink * 0.85);
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(lookX * 3, lookY * 2.5, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.white;
      ctx.beginPath();
      ctx.arc(lookX * 3 - 3, lookY * 2.5 - 3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Mouth
  if (happy) {
    ctx.beginPath();
    ctx.moveTo(-12, 10);
    ctx.quadraticCurveTo(0, 13, 12, 10);
    ctx.bezierCurveTo(11, 26, -11, 26, -12, 10);
    ctx.closePath();
    ctx.fillStyle = PAL.mouth;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = PAL.tongue;
    ctx.beginPath();
    ctx.ellipse(0, 23, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, 12);
    ctx.quadraticCurveTo(0, 20, 9, 12);
    ctx.stroke();
  }
}

/** @param {CanvasRenderingContext2D} ctx @param {any} info */
export default (ctx, { width, height, u, clip, ease, rig }) => {
  const TAU = Math.PI * 2;
  const cx = width * 0.5;
  const groundY = height * 0.84;

  let y = 0, rot = 0, squash = 1, sproutRot = 0, leafSpread = 0;
  let faceY = -44, happy = false, blink = 0, lookX = 0, lookY = 0;

  if (clip === 'jump') {
    if (u < 0.2) {
      const k = ease.inOutCubic(rig.remap(u, 0, 0.2));
      squash = rig.lerp(1, 0.76, k);
      leafSpread = -0.35 * k;
    } else if (u < 0.65) {
      const k = rig.remap(u, 0.2, 0.65);
      const arc = Math.sin(k * Math.PI);
      y = -62 * Math.pow(arc, 0.82);
      squash = 1 + 0.24 * Math.sin(k * Math.PI * 1.15);
      rot = Math.sin(k * Math.PI) * 0.08;
      leafSpread = 0.75 * ease.outBack(Math.min(1, k * 1.6));
      happy = true;
    } else {
      const sp = ease.spring((u - 0.65) * 1.1, { stiffness: 250, damping: 12 });
      squash = 0.76 + 0.24 * sp;
      leafSpread = 0.4 * (1 - Math.min(1, sp));
      happy = u < 0.82;
    }
    sproutRot = Math.sin(rig.phase(u, 0.12) * TAU) * 0.26;
  } else if (clip === 'happy') {
    const hop = Math.abs(Math.sin(u * TAU));
    y = -24 * hop;
    squash = 1 + (hop - 0.45) * 0.26;
    rot = Math.sin(u * TAU) * 0.14;
    sproutRot = Math.sin(rig.phase(u, 0.14) * TAU) * 0.34;
    leafSpread = 0.5 * hop;
    happy = true;
  } else {
    const breath = ease.inOutCubic(rig.pingpong(u));
    squash = rig.lerp(0.94, 1.07, breath);
    rot = Math.sin(u * TAU) * 0.04;
    sproutRot = Math.sin(rig.phase(u, 0.15) * TAU) * 0.16;
    leafSpread = breath * 0.25;
    faceY = -44 - breath * 3;
    blink = Math.sin(rig.remap(u, 0.74, 0.84) * Math.PI);
    lookX = Math.sin(u * TAU) * 0.55;
  }

  // Ground shadow shrinks softly while airborne
  const air = rig.clamp(-y / 70, 0, 1);
  ctx.fillStyle = `rgba(26, 46, 53, ${(0.16 * (1 - air * 0.45)).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 4, 62 * (1 - air * 0.32), 11 * (1 - air * 0.3), 0, 0, Math.PI * 2);
  ctx.fill();

  // Root anchored at ground contact so squash & stretch stays planted
  rig.node(ctx, { x: cx, y: groundY + y, rot, squash }, () => {
    drawBody(ctx);
    rig.node(ctx, { x: 0, y: -106, rot: sproutRot }, () => drawSprout(ctx, leafSpread));
    rig.node(ctx, { x: 0, y: faceY }, () => drawFace(ctx, { happy, blink, lookX, lookY }));
  });
};
