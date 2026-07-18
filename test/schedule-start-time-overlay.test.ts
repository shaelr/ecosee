// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { EcoseeScheduleStartTimeOverlay } from '../src/overlays/schedule-start-time-overlay';

// The Start Time picker reached by tapping an editable block on the Schedule
// sub-screen (ADR-0014). Its time field layers a transparent native
// <input type="time"> directly over a visible label to capture taps — the same
// trick schedule-add-block-overlay.ts's Start/End fields and the Comfort
// Setting/Interval dropdowns elsewhere use. A tap lands on the real input,
// giving it genuine focus, which is what actually opens the picker on iOS (it
// ties its native picker sheet to real focus, not to any particular API call).
// A version of this field routed the tap through a separate visible <button>
// whose click handler called the hidden input's showPicker() instead — that
// worked on desktop but showPicker() is unimplemented for date/time inputs on
// iOS WebKit (WebKit bug 261703, open since 2023), so the button did nothing
// on an iPhone; reverted back to the direct-tap pattern.

async function mount(
  overrides: Partial<
    Pick<
      EcoseeScheduleStartTimeOverlay,
      'comfortSetting' | 'dayLabel' | 'startMinutes' | 'canRemove'
    >
  > = {},
): Promise<EcoseeScheduleStartTimeOverlay> {
  const el = document.createElement(
    'ecosee-schedule-start-time-overlay',
  ) as EcoseeScheduleStartTimeOverlay;
  el.comfortSetting = overrides.comfortSetting ?? 'Sleep';
  el.dayLabel = overrides.dayLabel ?? 'Thursday';
  el.startMinutes = overrides.startMinutes ?? 8 * 60;
  el.canRemove = overrides.canRemove ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function timeInput(el: EcoseeScheduleStartTimeOverlay): HTMLInputElement {
  return el.shadowRoot!.querySelector('.field input') as HTMLInputElement;
}

describe('Schedule Start Time overlay — time field', () => {
  it('shows the current start time on the pill label', async () => {
    const el = await mount({ startMinutes: 8 * 60 + 30 });
    expect(el.shadowRoot!.querySelector('.pill-label')?.textContent?.trim()).toBe('08:30');
  });

  // Regression guard: a version of this field routed taps through a separate
  // visible <button> that called showPicker() on a hidden input — broken on
  // iOS (see module doc). The real input is now the direct tap target itself.
  it('the time input is the real, directly-tappable control — not a button with a hidden input behind it', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.pill-button')).toBeNull();
    const input = timeInput(el);
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('time');
    expect(input.getAttribute('tabindex')).not.toBe('-1');
    expect(input.getAttribute('aria-hidden')).not.toBe('true');
    expect(input.getAttribute('aria-label')).toBe('Start time');
  });

  // happy-dom's synthetic .click() doesn't perform a real browser's implicit
  // focus-on-click for form controls, so this asserts focusability directly.
  it('the time input is directly focusable', async () => {
    const el = await mount();
    const input = timeInput(el);
    input.focus();
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('emits ecosee-schedule-time-confirm with the snapped minutes once the input fires change', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let detail: { minutes: number } | undefined;
    el.addEventListener('ecosee-schedule-time-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    const input = timeInput(el);
    input.value = '09:10'; // snaps down to the 30-minute grid
    input.dispatchEvent(new Event('change'));

    expect(detail).toEqual({ minutes: 9 * 60 });
  });

  it('emits nothing when the input reports the same time already shown', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let fired = false;
    el.addEventListener('ecosee-schedule-time-confirm', () => (fired = true));

    const input = timeInput(el);
    input.value = '08:00';
    input.dispatchEvent(new Event('change'));

    expect(fired).toBe(false);
  });

  it('ignores a malformed value from the input', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let fired = false;
    el.addEventListener('ecosee-schedule-time-confirm', () => (fired = true));

    const input = timeInput(el);
    input.value = 'not-a-time';
    input.dispatchEvent(new Event('change'));

    expect(fired).toBe(false);
  });
});

describe('Schedule Start Time overlay — outline contract (double-outline fix)', () => {
  it('the field focus ring sits flush against the border (no outline-offset), not a detached second ring', () => {
    const css = [EcoseeScheduleStartTimeOverlay.styles]
      .flat()
      .map((s) => s.cssText)
      .join('\n');
    const rule = css.match(/\.field:focus-within\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/outline:\s*0\.5cqw solid/);
    expect(rule).toMatch(/outline-offset:\s*0\s*;/);
  });
});

describe('Schedule Start Time overlay — remove action', () => {
  it('hides the remove action when canRemove is false', async () => {
    const el = await mount({ canRemove: false });
    expect(el.shadowRoot!.querySelector('.remove')).toBeNull();
  });

  it('emits ecosee-schedule-block-remove when the remove action is tapped', async () => {
    const el = await mount({ canRemove: true });
    let fired = false;
    el.addEventListener('ecosee-schedule-block-remove', () => (fired = true));

    (el.shadowRoot!.querySelector('.remove') as HTMLButtonElement).click();

    expect(fired).toBe(true);
  });
});
