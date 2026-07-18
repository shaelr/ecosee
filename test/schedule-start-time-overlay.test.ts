// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EcoseeScheduleStartTimeOverlay } from '../src/overlays/schedule-start-time-overlay';

// The Start Time picker reached by tapping an editable block on the Schedule
// sub-screen (ADR-0014). Its time field uses the same real <button> + tiny hidden
// <input type="time"> triggered via showPicker() as Add to Schedule's Start/End
// fields and furnace-filter-overlay.ts's Last Changed date field — a tap on an
// invisible full-cover time input only focuses whatever internal segment happens
// to sit under the pointer, with no visible chrome to show which segment that is.

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

describe('Schedule Start Time overlay — time field', () => {
  it('shows the current start time on the pill button', async () => {
    const el = await mount({ startMinutes: 8 * 60 + 30 });
    expect(el.shadowRoot!.querySelector('.pill-button')?.textContent?.trim()).toBe('08:30');
  });

  it('clicking the pill button calls showPicker() on the hidden time input', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    const spy = vi.fn();
    // happy-dom doesn't implement showPicker(); stub it so the click handler's
    // existence check (`typeof input.showPicker === 'function'`) passes.
    input.showPicker = spy;

    (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // iOS WebKit doesn't implement showPicker() for date/time inputs at all
  // (WebKit bug 261703) — it's a silent no-op there. A WebKit engineer's own
  // suggested workaround is to call .focus() instead, which iOS ties its
  // native picker sheet to regardless of what triggered the focus. Calling
  // both means desktop engines get showPicker()'s "always opens, regardless
  // of where in the pill the tap landed" behavior (ADR-0017) while iOS still
  // gets a working picker via .focus() even though its own showPicker() does
  // nothing.
  it('clicking the pill button also focuses the hidden input directly (the iOS workaround)', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('still focuses the input even when showPicker is unsupported by the environment', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    expect((input as unknown as { showPicker?: unknown }).showPicker).toBeUndefined();
    (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('does not throw when showPicker is unavailable on the input (older engine)', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    (input as unknown as { showPicker: unknown }).showPicker = undefined;

    expect(() =>
      (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click(),
    ).not.toThrow();
  });

  it('does not throw when showPicker rejects the call (e.g. not a user gesture)', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    input.showPicker = () => {
      throw new Error('not a user gesture');
    };

    expect(() =>
      (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click(),
    ).not.toThrow();
  });

  it('emits ecosee-schedule-time-confirm with the snapped minutes once the hidden input fires change', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let detail: { minutes: number } | undefined;
    el.addEventListener('ecosee-schedule-time-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    input.value = '09:10'; // snaps down to the 30-minute grid
    input.dispatchEvent(new Event('change'));

    expect(detail).toEqual({ minutes: 9 * 60 });
  });

  it('emits nothing when the hidden input reports the same time already shown', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let fired = false;
    el.addEventListener('ecosee-schedule-time-confirm', () => (fired = true));

    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    input.value = '08:00';
    input.dispatchEvent(new Event('change'));

    expect(fired).toBe(false);
  });

  it('ignores a malformed value from the hidden input', async () => {
    const el = await mount({ startMinutes: 8 * 60 });
    let fired = false;
    el.addEventListener('ecosee-schedule-time-confirm', () => (fired = true));

    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    input.value = 'not-a-time';
    input.dispatchEvent(new Event('change'));

    expect(fired).toBe(false);
  });

  it('the hidden time input is never a direct tab stop or announced individually (tabindex="-1", aria-hidden)', async () => {
    const el = await mount();
    const input = el.shadowRoot!.querySelector('.time-native') as HTMLInputElement;
    expect(input.getAttribute('tabindex')).toBe('-1');
    expect(input.getAttribute('aria-hidden')).toBe('true');
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
