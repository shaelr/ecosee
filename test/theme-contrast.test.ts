import { describe, it, expect } from 'vitest';
import {
  relativeLuminance,
  contrastRatio,
  pickThemeTextColor,
  MIN_TEXT_CONTRAST,
  type Rgb,
  type ColorResolver,
} from '../src/styles/theme-contrast';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black against white (WCAG max)', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it('is 1:1 for identical colors (no contrast)', () => {
    expect(contrastRatio([100, 150, 200], [100, 150, 200])).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    const a: Rgb = [10, 20, 30];
    const b: Rgb = [200, 210, 220];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

// A fake resolver standing in for the real DOM-based one (resolve-css-color.ts) so
// pickThemeTextColor's decision logic is covered without a browser.
const fakeResolve = (table: Record<string, Rgb>): ColorResolver => {
  return (value: string) => table[value] ?? null;
};

describe('pickThemeTextColor', () => {
  const NEAR_BLACK_CANVAS = '#0a0d10';
  const NEAR_BLACK_RGB: Rgb = [10, 13, 16];

  it('adopts a light theme text color that clears WCAG AA against a near-black canvas', () => {
    const resolve = fakeResolve({
      'var(--primary-text-color)': [230, 230, 230], // a typical dark-theme light gray
      [NEAR_BLACK_CANVAS]: NEAR_BLACK_RGB,
    });
    expect(pickThemeTextColor('var(--primary-text-color)', NEAR_BLACK_CANVAS, resolve)).toBe(
      'var(--primary-text-color)',
    );
  });

  it('rejects a dark (light-theme) text color that would be unreadable on a near-black canvas', () => {
    const resolve = fakeResolve({
      'var(--primary-text-color)': [33, 33, 33], // a typical light-theme near-black
      [NEAR_BLACK_CANVAS]: NEAR_BLACK_RGB,
    });
    expect(pickThemeTextColor('var(--primary-text-color)', NEAR_BLACK_CANVAS, resolve)).toBeNull();
  });

  it('rejects when the theme color fails to resolve', () => {
    const resolve = fakeResolve({ [NEAR_BLACK_CANVAS]: NEAR_BLACK_RGB });
    expect(pickThemeTextColor('not-a-color', NEAR_BLACK_CANVAS, resolve)).toBeNull();
  });

  it('rejects when the canvas color fails to resolve', () => {
    const resolve = fakeResolve({ 'var(--primary-text-color)': [230, 230, 230] });
    expect(pickThemeTextColor('var(--primary-text-color)', 'not-a-color', resolve)).toBeNull();
  });

  it('rejects an empty theme color without calling resolve', () => {
    const resolve = fakeResolve({});
    expect(pickThemeTextColor('', NEAR_BLACK_CANVAS, resolve)).toBeNull();
  });

  it('rejects an empty canvas color without calling resolve', () => {
    const resolve = fakeResolve({});
    expect(pickThemeTextColor('var(--primary-text-color)', '', resolve)).toBeNull();
  });

  // Regression guard: a mid-gray theme color (e.g. #808080) clears WCAG AA (4.5:1)
  // against a near-black canvas but not AAA (7:1) — this Skin's thin type (weight
  // 300-400) read genuinely hard to read at an AA-only gray in practice (owner
  // report), so the bar is AAA, not AA. This pins the threshold's real-world effect,
  // not just its numeric value.
  it('rejects a mid-gray secondary-text-color that clears AA but not AAA', () => {
    const resolve = fakeResolve({
      'var(--secondary-text-color)': [128, 128, 128],
      [NEAR_BLACK_CANVAS]: NEAR_BLACK_RGB,
    });
    const ratio = contrastRatio([128, 128, 128], NEAR_BLACK_RGB);
    expect(ratio).toBeGreaterThanOrEqual(4.5); // clears AA
    expect(ratio).toBeLessThan(7); // but not AAA
    expect(
      pickThemeTextColor('var(--secondary-text-color)', NEAR_BLACK_CANVAS, resolve),
    ).toBeNull();
  });

  it('sits right at the MIN_TEXT_CONTRAST boundary consistently with contrastRatio', () => {
    const theme: Rgb = [128, 128, 128];
    const resolve = fakeResolve({ theme, [NEAR_BLACK_CANVAS]: NEAR_BLACK_RGB } as unknown as Record<
      string,
      Rgb
    >);
    const ratio = contrastRatio(theme, NEAR_BLACK_RGB);
    const picked = pickThemeTextColor('theme', NEAR_BLACK_CANVAS, resolve);
    expect(picked !== null).toBe(ratio >= MIN_TEXT_CONTRAST);
  });
});
