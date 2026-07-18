import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Static build of the interactive preview harness (dev/) for GitHub Pages — the
// live demo linked from the README. `base` is the project-pages path so the built
// index.html resolves its bundle under https://razzamatazm.github.io/ecosee/. The
// bundled Montserrat faces are imported as `?inline` data URIs (see
// src/styles/bundled-font.ts), so the output is fully self-contained.

// dev/main.ts pulls in src/ecosee-card.ts, which references __ECOSEE_VERSION__
// (the console-banner version, injected the same way in the main vite.config.ts
// build) — this separate config needs its own copy of the same define, or the
// identifier is left unresolved in this build.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  root: 'dev',
  base: '/ecosee/',
  define: {
    __ECOSEE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
    target: 'es2021',
  },
});
