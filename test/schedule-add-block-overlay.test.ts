// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EcoseeScheduleAddBlockOverlay } from '../src/overlays/schedule-add-block-overlay';
import type { ComfortSettingOption } from '../src/climate/comfort-setting';

// The "+" flow reached from the Schedule sub-screen (ADR-0014). Start/End use a
// real <button> + tiny hidden <input type="time"> triggered via showPicker() —
// the same split furnace-filter-overlay.ts's Last Changed date field uses and for
// the same reason: a tap on an invisible full-cover time input only focuses
// whatever internal segment happens to sit under the pointer, with no visible
// native chrome to show which segment that is, which reads to a user as "clicking
// doesn't do anything." A real button always has something to tap.

const COMFORT_SETTINGS: ComfortSettingOption[] = [
  { preset: 'home', label: 'Home', icon: 'home', selected: true },
  { preset: 'away', label: 'Away', icon: 'away', selected: false },
];

async function mount(
  overrides: Partial<Pick<EcoseeScheduleAddBlockOverlay, 'comfortSettings' | 'dayLabel'>> = {},
): Promise<EcoseeScheduleAddBlockOverlay> {
  const el = document.createElement(
    'ecosee-schedule-add-block-overlay',
  ) as EcoseeScheduleAddBlockOverlay;
  el.comfortSettings = overrides.comfortSettings ?? COMFORT_SETTINGS;
  el.dayLabel = overrides.dayLabel ?? 'Saturday';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function fieldRow(el: EcoseeScheduleAddBlockOverlay, index: number): Element {
  return el.shadowRoot!.querySelectorAll('.field-row')[index]!;
}

describe('Schedule Add Block overlay — Start/End time fields', () => {
  it('shows the default 08:00–10:00 window on the pill buttons', async () => {
    const el = await mount();
    expect(fieldRow(el, 1).querySelector('.pill-button')?.textContent?.trim()).toBe('08:00');
    expect(fieldRow(el, 2).querySelector('.pill-button')?.textContent?.trim()).toBe('10:00');
  });

  it('clicking the Start pill button calls showPicker() on its own hidden time input, not the End field’s', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    const startSpy = vi.fn();
    const endSpy = vi.fn();
    // happy-dom doesn't implement showPicker(); stub it so the click handler's
    // existence check (`typeof input.showPicker === 'function'`) passes.
    startInput.showPicker = startSpy;
    endInput.showPicker = endSpy;

    (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).not.toHaveBeenCalled();
  });

  it('clicking the End pill button calls showPicker() on the End field’s own hidden input', async () => {
    const el = await mount();
    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    const endSpy = vi.fn();
    endInput.showPicker = endSpy;

    (fieldRow(el, 2).querySelector('.pill-button') as HTMLButtonElement).click();

    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  // iOS WebKit doesn't implement showPicker() for date/time inputs at all
  // (WebKit bug 261703) — it's a silent no-op there. A WebKit engineer's own
  // suggested workaround is to call .focus() instead, which iOS ties its
  // native picker sheet to regardless of what triggered the focus. Calling
  // both means desktop engines get showPicker()'s "always opens, regardless
  // of where in the pill the tap landed" behavior (ADR-0017) while iOS still
  // gets a working picker via .focus() even though its own showPicker() does
  // nothing.
  it('clicking a pill button also focuses its own hidden input directly (the iOS workaround)', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click();
    expect(el.shadowRoot!.activeElement).toBe(startInput);

    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    (fieldRow(el, 2).querySelector('.pill-button') as HTMLButtonElement).click();
    expect(el.shadowRoot!.activeElement).toBe(endInput);
  });

  it('still focuses the input even when showPicker is unsupported by the environment', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    expect((startInput as unknown as { showPicker?: unknown }).showPicker).toBeUndefined();
    (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click();
    expect(el.shadowRoot!.activeElement).toBe(startInput);
  });

  it('does not throw when showPicker is unavailable on the input (older engine)', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    // Simulate an engine without showPicker() (it's Baseline 2023, not universal) —
    // happy-dom doesn't implement it either, but assign explicitly for clarity.
    (startInput as unknown as { showPicker: unknown }).showPicker = undefined;

    expect(() =>
      (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click(),
    ).not.toThrow();
  });

  it('does not throw when showPicker rejects the call (e.g. not a user gesture)', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    startInput.showPicker = () => {
      throw new Error('not a user gesture');
    };

    expect(() =>
      (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click(),
    ).not.toThrow();
  });

  it('updates the Start pill button’s label once the hidden input fires change', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    startInput.value = '09:30';
    startInput.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 1).querySelector('.pill-button')?.textContent?.trim()).toBe('09:30');
  });

  it('updates the End pill button’s label once the hidden input fires change', async () => {
    const el = await mount();
    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    endInput.value = '14:00';
    endInput.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 2).querySelector('.pill-button')?.textContent?.trim()).toBe('14:00');
  });

  it('ignores a malformed value from the hidden input rather than corrupting state', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    startInput.value = 'not-a-time';
    startInput.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 1).querySelector('.pill-button')?.textContent?.trim()).toBe('08:00');
  });

  it('the hidden time inputs are never a direct tab stop or announced individually (tabindex="-1", aria-hidden)', async () => {
    const el = await mount();
    const startInput = fieldRow(el, 1).querySelector('.start-native') as HTMLInputElement;
    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    expect(startInput.getAttribute('tabindex')).toBe('-1');
    expect(startInput.getAttribute('aria-hidden')).toBe('true');
    expect(endInput.getAttribute('tabindex')).toBe('-1');
    expect(endInput.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Schedule Add Block overlay — validation and confirm', () => {
  it('disables Add to Schedule and shows an error once End is not after Start', async () => {
    const el = await mount();
    const endInput = fieldRow(el, 2).querySelector('.end-native') as HTMLInputElement;
    endInput.value = '07:00'; // before the 08:00 default Start
    endInput.dispatchEvent(new Event('change'));
    await el.updateComplete;

    const confirmButton = el.shadowRoot!.querySelector('.confirm') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector('.error')?.textContent?.trim()).toBe(
      'End time must be after start time.',
    );
  });

  it('emits ecosee-schedule-add-block-confirm with the selected comfort setting and times', async () => {
    const el = await mount();
    let detail: { comfortSetting: string; startMinutes: number; endMinutes: number } | undefined;
    el.addEventListener('ecosee-schedule-add-block-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (el.shadowRoot!.querySelector('.confirm') as HTMLButtonElement).click();

    expect(detail).toEqual({ comfortSetting: 'home', startMinutes: 8 * 60, endMinutes: 10 * 60 });
  });
});

describe('Schedule Add Block overlay — outline contract (double-outline fix)', () => {
  it('the shared pill focus ring sits flush against the border (no outline-offset), not a detached second ring', () => {
    const css = [EcoseeScheduleAddBlockOverlay.styles]
      .flat()
      .map((s) => s.cssText)
      .join('\n');
    const rule = css.match(/\.pill:focus-within\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/outline:\s*0\.5cqw solid/);
    expect(rule).toMatch(/outline-offset:\s*0\s*;/);
  });
});
