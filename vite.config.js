import { defineConfig } from 'vite';

// Relative base so the same build runs on GitHub Pages (/repo-name/), a custom domain, or a local folder.
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
});
