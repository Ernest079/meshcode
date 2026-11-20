// Bundles the sandbox runtime (three.js + src/core) into ONE self-contained ES module: web/public/runtime.js.
// It must not import anything at runtime, because the sandboxed frame loads it from a blob: URL.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: 'web/runtime/main.js', formats: ['es'], fileName: () => 'runtime.js' },
    outDir: 'web/public',
    emptyOutDir: false,
    // Lib mode keeps whitespace in ES output even with build.minify; ask rolldown for full minification.
    rolldownOptions: { output: { minify: true } },
  },
});
