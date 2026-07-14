# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Commands

```bash
npm run dev           # live preview harness at /dev/, hand-built sample states, no HA needed
npm test               # unit tests (vitest, single run)
npm run test:watch     # unit tests, watch mode
npm run test:browser   # rendering checks in real headless Firefox (npx playwright install firefox first)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format         # prettier --write .
npm run format:check   # prettier --check .
npm run build          # tsc --noEmit && vite build -> single ES module at dist/ecosee.js
npm run demo           # static build of the preview harness for GitHub Pages
```

Run a single test file with `npx vitest run test/<name>.test.ts`, or a single case with `npx vitest run test/<name>.test.ts -t "<test name>"`.

### Releasing

Bump `version` in `package.json` and merge to `main`; the Release workflow builds the bundle and publishes a GitHub Release named `v<version>` with `dist/ecosee.js` attached (HACS resolves to that asset). A push to `main` that doesn't change the version is a no-op. If the automated workflow doesn't fire (e.g. Actions disabled on a fork), build and release manually: `npm run build && gh release create v<version> dist/ecosee.js`.

## Architecture

ecosee is a Home Assistant custom Lovelace card (Lit + TypeScript) that emulates the ecobee Smart Thermostat Premium's on-wall UI over _any_ `climate` entity — see `CONTEXT.md` for the full domain glossary (Card/Skin/Screen/Overlay vocabulary, terms to avoid) and `docs/adr/` for why things are the way they are. It's a **generic thermostat card wearing an ecobee skin** (ADR-0001): full ecobee fidelity when rich data is present, graceful degradation to a simpler face when it isn't. Read `CONTEXT.md` and any relevant ADRs before naming a new domain concept or overriding an existing decision.

### Data flow: seams, Models/Views, dumb rendering

Each `src/climate/*.ts`, `src/sensors/*.ts`, `src/weather/*.ts` file is a **seam**: a pure function taking `(hass, config)` and returning a plain data object (a `HomeView`, `FanModel`, `TempAdjustModel`, `SensorsModel`, `WeatherModel`, …), with all HA-attribute parsing, unit conversion, and graceful-degradation logic living there. `src/climate/home-view.ts`'s `toHomeView` is the central one, called once per render in `ecosee-card.ts`. These seams are unit-tested directly against fabricated `hass`/`config` fixtures — no DOM needed — which is most of the test suite.

Screens (`src/screens/`) and Overlays (`src/overlays/`) are Lit components that render a Model/View and emit events (`ecosee-action`, `ecosee-service-call`, `ecosee-*-select`, `ecosee-overlay-dismiss`); they contain no HA-parsing logic themselves. `src/ecosee-card.ts` is the host: it owns `hass`/config, calls the seams, and is the single place service calls and navigation events are caught and dispatched back to `hass.callService`.

### Overlay routing

`ecosee-card.ts` keeps a navigation stack (`_nav: OverlayKind[]`, hub-and-picker — CONTEXT.md) and a `_overlays` table keyed by `OverlayKind`, each entry declaring `available(hass, config)`, an optional `onOpen`, and `render(hass, config)`. Adding an Overlay is one table entry, not a branch scattered across the file. The Home Screen is only ever mounted when no Overlay is open — not just visually covered, genuinely absent from the DOM — so an Overlay's own canvas can safely share the same background token, including `transparent`, with nothing left underneath to bleed through. Standby Screen replaces the whole render output the same way, from a separate top-level `_standby` flag.

### Fixed-canvas + CSS-variable scaling

The entire Card is laid out **once** at a fixed `460×460` canvas (`--ecosee-base-size` in `src/styles/tokens.ts`) using a fixed layout unit `--ecosee-u` (`base-size / 100`) for every internal length — never `cqw`/`cqh`, because an element that is itself a `container-type` container resolves its own container-query units against the _viewport_, not its own box, which breaks on a wide window (issue #35). `ecosee-card.ts` measures its host's slot width (`ResizeObserver` + `_syncDeviceScale`), clamps it between `--ecosee-min-size`/`--ecosee-max-size`, and applies the result as one `transform: scale()` on `.root` — so the layout never reflows per-width and renders identically at every size. Screens/Overlays that themselves need `cqw` scaling for their _own_ internal content (numerals, icons) declare their own `container-type: inline-size` at that same fixed base size.

### Design tokens and the squircle silhouette

`src/styles/tokens.ts` declares the Skin's palette and sizing as inherited CSS custom properties on the card's `:host`, cascading through every shadow boundary. `src/styles/shape.ts` is the single shared superellipse (“squircle”) path plus the equipment-status edge glow, rendered as the first child of every screen/overlay surface so the silhouette and glow never drift between them (ADR-0006, ADR-0009, ADR-0011). Most colors are fixed literals matching the physical device (cyan accent, amber Heat, blue Cool) rather than following the Home Assistant dashboard theme (`CONTEXT.md`: _"Avoid: theme, style, template"_) — the one deliberate, narrow exception is documented in ADR-0013 (`--ecosee-text`/`--ecosee-text-accent`, contrast-gated against Home Assistant's own theme variables; thin/numeral readouts and anything carrying device-specific meaning are excluded).

### Typography

The device face is Gotham, which can't ship with the card; Montserrat is the closest freely-licensed alternative, bundled and registered at runtime (`src/styles/bundled-font.ts`, ADR-0007/0008) so every install renders correctly with zero configuration. `src/styles/font-probe.ts` quarantines a dashboard-supplied `Montserrat` with broken metrics (issue #85) — it splits a DOM-dependent canvas-measuring function from pure, unit-tested decision logic, a pattern reused in `src/styles/resolve-css-color.ts`/`theme-contrast.ts`.

### Config and the visual editor

`src/config.ts` parses and validates the YAML/object config into `EcoseeCardConfig`, one parser function per key, each returning `undefined` when absent and throwing a user-facing error for an invalid type. `src/editor/` is the GUI config editor HA mounts from the dashboard's card picker (`getConfigElement`/`getStubConfig` in `ecosee-card.ts`); it must stay in sync with `config.ts`'s keys.

### Testing

Unit tests (`npm test`) run under Vitest; most are pure-logic tests against fabricated `hass`/`config` fixtures (no DOM). Tests that need a DOM opt in per-file with a `// @vitest-environment happy-dom` pragma at the top. `test/browser/**` is excluded from the default run and instead runs under `npm run test:browser` inside **real headless Firefox** via Playwright (`vitest.browser.config.ts`) — happy-dom/jsdom can only string-match CSS text, which is exactly how several Gecko-vs-Blink rendering regressions shipped while string-matching guards stayed green (issues #35/#52, #74, #85); these tests assert on actual computed boxes/pixels.

The `dev/` preview harness (served by `npm run dev` at `/dev/`, and statically built by `npm run demo` for GitHub Pages) renders the card against hand-built sample `hass` states, so UI work doesn't require a running Home Assistant instance.
