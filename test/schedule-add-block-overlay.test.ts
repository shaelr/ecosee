// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { EcoseeScheduleAddBlockOverlay } from '../src/overlays/schedule-add-block-overlay';
import type { ComfortSettingOption } from '../src/climate/comfort-setting';

// The "+" flow reached from the Schedule sub-screen (ADR-0014). Start/End (and
// Comfort Setting) each layer a transparent native control directly over a
// visible label to capture taps — the same trick fan-overlay.ts's runtime
// <select> uses. A tap lands on the real form control, giving it genuine focus,
// which matters beyond hit testing: iOS only opens its native picker sheet for
// a date/time input (or wheel for a select) when the control itself receives
// real focus from a user gesture. A version of Start/End instead routed the tap
// through a separate visible <button> whose click handler called a hidden
// input's showPicker() — that worked on desktop but showPicker() is
// unimplemented for date/time inputs on iOS WebKit (WebKit bug 261703), so the
// button did nothing there; reverted back to the direct-tap pattern.

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

function startInput(el: EcoseeScheduleAddBlockOverlay): HTMLInputElement {
  return fieldRow(el, 1).querySelector('input') as HTMLInputElement;
}

function endInput(el: EcoseeScheduleAddBlockOverlay): HTMLInputElement {
  return fieldRow(el, 2).querySelector('input') as HTMLInputElement;
}

describe('Schedule Add Block overlay — Start/End time fields', () => {
  it('shows the default 08:00–10:00 window on the pill labels', async () => {
    const el = await mount();
    expect(fieldRow(el, 1).querySelector('.pill-label')?.textContent?.trim()).toBe('08:00');
    expect(fieldRow(el, 2).querySelector('.pill-label')?.textContent?.trim()).toBe('10:00');
  });

  // Regression guard: a version of this field routed taps through a separate
  // visible <button> that called showPicker() on a hidden input — broken on
  // iOS (see module doc). The real input is now the direct tap target itself.
  it('the time input is the real, directly-tappable control — not a button with a hidden input behind it', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.pill-button')).toBeNull();
    const start = startInput(el);
    expect(start.tagName).toBe('INPUT');
    expect(start.type).toBe('time');
    expect(start.getAttribute('tabindex')).not.toBe('-1');
    expect(start.getAttribute('aria-hidden')).not.toBe('true');
    expect(start.getAttribute('aria-label')).toBe('Start time');
  });

  // happy-dom's synthetic .click() doesn't perform a real browser's implicit
  // focus-on-click for form controls, so this asserts focusability directly.
  it('the Start and End inputs are each directly focusable', async () => {
    const el = await mount();
    const start = startInput(el);
    start.focus();
    expect(el.shadowRoot!.activeElement).toBe(start);

    const end = endInput(el);
    end.focus();
    expect(el.shadowRoot!.activeElement).toBe(end);
  });

  it('updates the Start pill label once the input fires change', async () => {
    const el = await mount();
    const input = startInput(el);
    input.value = '09:30';
    input.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 1).querySelector('.pill-label')?.textContent?.trim()).toBe('09:30');
  });

  it('updates the End pill label once the input fires change', async () => {
    const el = await mount();
    const input = endInput(el);
    input.value = '14:00';
    input.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 2).querySelector('.pill-label')?.textContent?.trim()).toBe('14:00');
  });

  it('ignores a malformed value from the input rather than corrupting state', async () => {
    const el = await mount();
    const input = startInput(el);
    input.value = 'not-a-time';
    input.dispatchEvent(new Event('change'));
    await el.updateComplete;

    expect(fieldRow(el, 1).querySelector('.pill-label')?.textContent?.trim()).toBe('08:00');
  });
});

describe('Schedule Add Block overlay — validation and confirm', () => {
  it('disables Add to Schedule and shows an error once End is not after Start', async () => {
    const el = await mount();
    const input = endInput(el);
    input.value = '07:00'; // before the 08:00 default Start
    input.dispatchEvent(new Event('change'));
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
