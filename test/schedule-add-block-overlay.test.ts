// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { EcoseeScheduleAddBlockOverlay } from '../src/overlays/schedule-add-block-overlay';
import type { ComfortSettingOption } from '../src/climate/comfort-setting';

// The "+" flow reached from the Schedule sub-screen (ADR-0014). A fully
// controlled component (ADR-0018): comfortSetting/startMinutes/endMinutes are
// props, owned by the host, not local state — because tapping Start or End
// pushes ecosee's own time-picker Overlay on top of *this* screen, and only
// the top-of-stack Overlay is ever mounted, so this component itself
// unmounts while that picker is open. Local state would be lost the moment
// the user picked a time and came back.

const COMFORT_SETTINGS: ComfortSettingOption[] = [
  { preset: 'home', label: 'Home', icon: 'home', selected: true },
  { preset: 'away', label: 'Away', icon: 'away', selected: false },
];

async function mount(
  overrides: Partial<
    Pick<
      EcoseeScheduleAddBlockOverlay,
      'comfortSettings' | 'dayLabel' | 'comfortSetting' | 'startMinutes' | 'endMinutes'
    >
  > = {},
): Promise<EcoseeScheduleAddBlockOverlay> {
  const el = document.createElement(
    'ecosee-schedule-add-block-overlay',
  ) as EcoseeScheduleAddBlockOverlay;
  el.comfortSettings = overrides.comfortSettings ?? COMFORT_SETTINGS;
  el.dayLabel = overrides.dayLabel ?? 'Saturday';
  el.comfortSetting = overrides.comfortSetting ?? 'home';
  el.startMinutes = overrides.startMinutes ?? 8 * 60;
  el.endMinutes = overrides.endMinutes ?? 10 * 60;
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
  it('shows the given Start/End props on the pill buttons', async () => {
    const el = await mount({ startMinutes: 8 * 60, endMinutes: 10 * 60 });
    expect(fieldRow(el, 1).querySelector('.pill-button')?.textContent?.trim()).toBe('08:00');
    expect(fieldRow(el, 2).querySelector('.pill-button')?.textContent?.trim()).toBe('10:00');
  });

  it('reflects an updated startMinutes/endMinutes prop immediately (a controlled component)', async () => {
    const el = await mount({ startMinutes: 8 * 60, endMinutes: 10 * 60 });
    el.startMinutes = 9 * 60 + 30;
    el.endMinutes = 14 * 60;
    await el.updateComplete;

    expect(fieldRow(el, 1).querySelector('.pill-button')?.textContent?.trim()).toBe('09:30');
    expect(fieldRow(el, 2).querySelector('.pill-button')?.textContent?.trim()).toBe('14:00');
  });

  it('clicking the Start pill emits ecosee-time-picker-open with target add-block-start', async () => {
    const el = await mount();
    let detail: { target: string } | undefined;
    el.addEventListener('ecosee-time-picker-open', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click();

    expect(detail).toEqual({ target: 'add-block-start' });
  });

  it('clicking the End pill emits ecosee-time-picker-open with target add-block-end', async () => {
    const el = await mount();
    let detail: { target: string } | undefined;
    el.addEventListener('ecosee-time-picker-open', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (fieldRow(el, 2).querySelector('.pill-button') as HTMLButtonElement).click();

    expect(detail).toEqual({ target: 'add-block-end' });
  });

  it('owns no native time input or write logic of its own — no other event fires from tapping Start/End', async () => {
    const el = await mount();
    let otherEvents = 0;
    el.addEventListener('ecosee-schedule-add-block-confirm', () => (otherEvents += 1));
    el.addEventListener('ecosee-service-call', () => (otherEvents += 1));

    (fieldRow(el, 1).querySelector('.pill-button') as HTMLButtonElement).click();
    (fieldRow(el, 2).querySelector('.pill-button') as HTMLButtonElement).click();

    expect(otherEvents).toBe(0);
  });
});

describe('Schedule Add Block overlay — Comfort Setting field', () => {
  it('shows the given comfortSetting prop’s label', async () => {
    const el = await mount({ comfortSetting: 'away' });
    const row = fieldRow(el, 0);
    expect(row.querySelector('.pill-label')?.textContent).toBe('Away');
  });

  it('emits ecosee-schedule-add-block-comfort-change on select, not a local state mutation', async () => {
    const el = await mount({ comfortSetting: 'home' });
    let detail: { comfortSetting: string } | undefined;
    el.addEventListener('ecosee-schedule-add-block-comfort-change', (event) => {
      detail = (event as CustomEvent).detail;
    });

    const select = el.shadowRoot!.querySelector('.select-native') as HTMLSelectElement;
    select.value = 'away';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(detail).toEqual({ comfortSetting: 'away' });
  });
});

describe('Schedule Add Block overlay — validation and confirm', () => {
  it('disables Add to Schedule and shows an error once End is not after Start', async () => {
    const el = await mount({ startMinutes: 8 * 60, endMinutes: 7 * 60 });

    const confirmButton = el.shadowRoot!.querySelector('.confirm') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    expect(el.shadowRoot!.querySelector('.error')?.textContent?.trim()).toBe(
      'End time must be after start time.',
    );
  });

  it('emits ecosee-schedule-add-block-confirm with the current props’ comfort setting and times', async () => {
    const el = await mount({ comfortSetting: 'home', startMinutes: 8 * 60, endMinutes: 10 * 60 });
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
