import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Real-engine rendering suite (issue #85). The jsdom/happy-dom unit tests can
// only string-match CSS text, which is exactly how three Gecko-vs-Blink
// regressions (#35/#52, #74, #85) shipped while the guards stayed green. This
// config runs test/browser/** inside REAL headless Firefox via Playwright, so
// assertions are made against boxes and pixels Gecko actually computed.
// Run with `npm run test:browser`; the unit suite excludes test/browser/**.

// gecko-parity.test.ts imports src/ecosee-card.ts, which references
// __ECOSEE_VERSION__ (the console-banner version) — this separate config
// needs its own copy of the same define the main vite.config.ts carries, or
// the identifier is left unresolved in this suite.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  define: {
    __ECOSEE_VERSION__: JSON.stringify(pkg.version),
  },
  optimizeDeps: {
    // Pre-bundle every lit entry the card imports. Without this, vite discovers
    // the directive entries mid-run on a cold cache (CI is always cold) and
    // reloads the test page, which vitest warns can flake or duplicate tests.
    include: ['lit', 'lit/decorators.js', 'lit/directives/repeat.js', 'lit/directives/style-map.js'],
  },
  test: {
    include: ['test/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'firefox',
      headless: true,
      screenshotFailures: false,
      // The Card lays out on a fixed 460px canvas (--ecosee-base-size); give
      // the test iframe room so screenshots capture the whole square.
      viewport: { width: 600, height: 600 },
    },
  },
});
