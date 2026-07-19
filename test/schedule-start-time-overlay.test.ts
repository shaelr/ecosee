// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { EcoseeScheduleStartTimeOverlay } from '../src/overlays/schedule-start-time-overlay';

// The Start Time picker reached by tapping an editable block on the Schedule
// sub-screen (ADR-0014). Tapping the time field pushes ecosee's own
// time-picker Overlay (ADR-0018) — there is no native form control here at
// all anymore, and this component itself owns no write logic for the time
// value; the host applies the write once that nested picker confirms.

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

  it('clicking the pill emits ecosee-time-picker-open with target schedule-start-time', async () => {
    const el = await mount();
    let detail: { target: string } | undefined;
    el.addEventListener('ecosee-time-picker-open', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();

    expect(detail).toEqual({ target: 'schedule-start-time' });
  });

  it('owns no native time input or write logic of its own', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('input')).toBeNull();

    let otherEvents = 0;
    el.addEventListener('ecosee-schedule-block-remove', () => (otherEvents += 1));
    (el.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();
    expect(otherEvents).toBe(0);
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
