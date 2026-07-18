import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

// Single self-contained ES module for HACS (Lit is bundled in, not externalized,
// so the card is self-sufficient inside Home Assistant). The dev server serves the
// preview harness under dev/ — see dev/index.html.

// The single source of truth for the console-banner version (ecosee-card.ts's
// __ECOSEE_VERSION__) — read once here rather than duplicated/hand-typed, so a
// release's version bump (package.json) can never leave the banner stale again.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __ECOSEE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    lib: {
      entry: 'src/ecosee-card.ts',
      formats: ['es'],
      fileName: () => 'ecosee.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021',
    minify: 'esbuild',
  },
  server: {
    open: '/dev/',
  },
  test: {
    include: ['test/**/*.test.ts'],
    // test/browser/** runs in real headless Firefox via vitest.browser.config.ts
    // (issue #85) — it asserts on rendered boxes/pixels, which need a real engine.
    exclude: [...configDefaults.exclude, 'test/browser/**'],
    environment: 'node',
  },
});
