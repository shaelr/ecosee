import { describe, it, expect } from 'vitest';
import { EcoseeComfortSettingOverlay } from '../src/overlays/comfort-setting-overlay';
import { EcoseeTemperatureOverlay } from '../src/overlays/temperature-overlay';
import { EcoseeFanOverlay } from '../src/overlays/fan-overlay';
import { EcoseeSystemModeOverlay } from '../src/overlays/system-mode-overlay';

// Regression guard for the --ecosee-bg / --ecosee-chip-ink split (config
// background_color): a selected, accent-filled row/chip/segment's text must stay
// on the dedicated --ecosee-chip-ink token, never fall back onto --ecosee-bg — the
// whole point of the split is that overriding the card's canvas background can
// never make this text illegible. Asserted against each component's static
// `styles.cssText` (mirrors shared-shape.test.ts's own convention) rather than a
// live-rendered getComputedStyle, since these are static, non-reactive style blocks.

describe('selected-chip text uses --ecosee-chip-ink, not --ecosee-bg', () => {
  it('Comfort Setting picker: .option.selected', () => {
    const css = EcoseeComfortSettingOverlay.styles.cssText;
    expect(css).toMatch(/\.option\.selected\s*\{[^}]*color:\s*var\(\s*--ecosee-chip-ink/);
  });

  it('System Mode picker: .option.selected', () => {
    const css = EcoseeSystemModeOverlay.styles.cssText;
    expect(css).toMatch(/\.option\.selected\s*\{[^}]*color:\s*var\(\s*--ecosee-chip-ink/);
  });

  it('Fan picker: .segment.selected', () => {
    const css = EcoseeFanOverlay.styles.cssText;
    expect(css).toMatch(/\.segment\.selected\s*\{[^}]*color:\s*var\(\s*--ecosee-chip-ink/);
  });

  it('Temperature Adjust: .chip.cool.selected and .chip.heat.selected', () => {
    const css = EcoseeTemperatureOverlay.styles.cssText;
    expect(css).toMatch(/\.chip\.cool\.selected\s*\{[^}]*color:\s*var\(\s*--ecosee-chip-ink/);
    expect(css).toMatch(/\.chip\.heat\.selected\s*\{[^}]*color:\s*var\(\s*--ecosee-chip-ink/);
  });

  it('the native Fan minimum-runtime dropdown background still tracks --ecosee-bg (a real background, not chip text)', () => {
    const css = EcoseeFanOverlay.styles.cssText;
    expect(css).toMatch(/\.select-native option\s*\{[^}]*background:\s*var\(\s*--ecosee-bg/);
  });
});
