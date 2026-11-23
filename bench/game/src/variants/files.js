// @ts-check
// Variant A — pure files: models + textures (GLB, meshopt), effects (flipbook + sprite images) and the
// level layout (JSON) are all downloaded; the code only places and animates them.
import { start } from '../game.js';
import { loadEffects, loadModels, TEX } from './assets.js';

start({
  name: `files-${TEX}`,
  load: async (renderer) => {
    const [models, effects, layout] = await Promise.all([
      loadModels(renderer), loadEffects(renderer), fetch('./assets/layout.json').then((r) => r.json()),
    ]);
    return { ...models, ...effects, layout };
  },
});
