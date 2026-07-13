/**
 * Decides whether a Home Assistant theme's text color is legible enough to adopt,
 * given the Card's own canvas color. HA's `--primary-text-color` / `--secondary-
 * text-color` are calibrated to sit on the *dashboard's* own background — in a light
 * theme that's a dark color meant for a light surface. This Card's canvas defaults to
 * a fixed near-black (config `background_color`, else tokens.ts's `--ecosee-bg`)
 * regardless of the dashboard's light/dark theme, so a light theme's dark text used
 * verbatim on it would read as near-invisible dark-on-near-black. Only trusted once it
 * clears WCAG AAA (not just AA — see {@link MIN_TEXT_CONTRAST}) against the actual
 * canvas color in play; the caller falls back to the Skin's own fixed off-white/
 * muted-gray otherwise (tokens.ts's `--ecosee-text` / `--ecosee-text-muted` defaults).
 */

export type Rgb = readonly [number, number, number];

/** WCAG 2.x relative luminance of one sRGB channel (0-255). */
function srgbChannel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an [r, g, b] triple. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** WCAG 2.x contrast ratio between two colors: 1 (no contrast) to 21 (max). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AAA's normal-text threshold (not AA's 4.5:1) — the bar a theme color must
 *  clear against the canvas before the Skin trusts it over its own fixed fallback.
 *  AA technically passes plenty of theme grays that are only barely legible in
 *  practice: this Skin's type is thin (weight 300-400 throughout, sometimes
 *  lighter), which reads noticeably worse than AA's normal-weight assumption at the
 *  same ratio, and a "muted"/secondary theme color that clears AA by a hair still
 *  looked genuinely hard to read against the near-black canvas (owner report,
 *  screenshot). AAA's stricter bar keeps the adopted color meaningfully closer to
 *  the dashboard's own crisp foreground rather than its dimmest still-technically-
 *  legible gray. */
export const MIN_TEXT_CONTRAST = 7;

/** Turns an arbitrary CSS color string (hex, `rgb()`, a cascaded custom property's
 *  resolved value, …) into an RGB triple, or `null` if it can't be resolved. Real
 *  callers pass a DOM-based resolver (`resolve-css-color.ts`) that lets the browser
 *  itself parse it; tests inject a fake one so the decision below is covered without a
 *  real DOM. */
export type ColorResolver = (value: string) => Rgb | null;

/**
 * Should the Skin adopt `themeColorRaw` as a text color, given the canvas it will
 * actually render on (`canvasColorRaw`)? Returns the theme color string unchanged
 * (so the caller can apply it verbatim, custom-property references included) when it
 * clears {@link MIN_TEXT_CONTRAST} against the canvas; `null` when it doesn't, when
 * either color is empty, or when either fails to resolve — the caller's own fixed
 * fallback wins in every one of those cases.
 */
export function pickThemeTextColor(
  themeColorRaw: string,
  canvasColorRaw: string,
  resolve: ColorResolver,
): string | null {
  if (!themeColorRaw.trim() || !canvasColorRaw.trim()) return null;
  const themeRgb = resolve(themeColorRaw);
  const canvasRgb = resolve(canvasColorRaw);
  if (!themeRgb || !canvasRgb) return null;
  return contrastRatio(themeRgb, canvasRgb) >= MIN_TEXT_CONTRAST ? themeColorRaw : null;
}
