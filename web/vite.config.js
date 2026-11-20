import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './', // works under any GitHub Pages sub-path
  plugins: [tailwindcss()],
  // CodeMirror + its JavaScript/TypeScript grammar is ~510 kB minified (170 kB gzip); three.js is NOT here (sandbox runtime).
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 600 },
});
