import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Three pages, one per variant; shared code (three.js, the game) lands in shared chunks.
const page = (/** @type {string} */ name) => fileURLToPath(new URL(`./game/${name}.html`, import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./game', import.meta.url)),
  base: './',
  logLevel: 'warn',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
    rolldownOptions: { input: { files: page('files'), hybrid: page('hybrid'), code: page('code') } },
  },
});
