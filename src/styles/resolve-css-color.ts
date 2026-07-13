import type { Rgb } from './theme-contrast';

/**
 * Turns an arbitrary CSS color string into an `[r, g, b]` triple by letting the
 * browser itself parse it — via a detached probe element's computed style — rather
 * than hand-rolling a parser for every CSS color syntax (hex, `rgb()`/`rgba()`,
 * `hsl()`, named colors, a cascaded custom property's resolved value, …). Returns
 * `null` for an invalid or empty string, or outside a browser (SSR / vitest's
 * happy-dom, which doesn't normalize color values the way a real browser does —
 * covered by `test/browser/*` instead, matching `font-probe.ts`'s canvas-measure
 * split between pure logic and DOM-dependent glue).
 */
let probe: HTMLDivElement | null = null;

export function resolveCssColor(value: string): Rgb | null {
  if (!value.trim() || typeof document === 'undefined') return null;
  if (!probe) {
    probe = document.createElement('div');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  probe.style.color = '';
  probe.style.color = value;
  if (!probe.style.color) return null;
  const match = getComputedStyle(probe).color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/,
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
