// @ts-check
// Variant B — hybrid: models + textures are files (GLB, meshopt); the layout is generated from the
// seed and the effects are shaders (code).
import { start } from '../game.js';
import { generateLayout } from '../layout.js';
import { loadModels, TEX } from './assets.js';

start({
  name: `hybrid-${TEX}`,
  load: async (renderer) => ({ ...(await loadModels(renderer)), layout: generateLayout(), flipbook: null, sprite: null }),
});
