import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext', assetsInlineLimit: 0 },
  // These ship raw .wasm next to their JS. Vite's dev pre-bundler rewrites the
  // module path but not the wasm's, so the fetch comes back as index.html.
  optimizeDeps: { exclude: ['gifski-wasm', '@jsquash/resize'] },
});
