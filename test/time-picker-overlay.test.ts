// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import '../src/overlays/time-picker-overlay';
import type { EcoseeTimePickerOverlay } from '../src/overlays/time-picker-overlay';

// ecosee's own time picker (ADR-0018): two independent scrollable columns
// (Hour 00-23, Minute 00/30) plus an explicit Confirm button, replacing the
// browser's native <input type="time"> picker everywhere ecosee edits a time
// value.

async function mount(minutes = 0): Promise<EcoseeTimePickerOverlay> {
  const el = document.createElement('ecosee-time-picker-overlay') as EcoseeTimePickerOverlay;
  el.minutes = minutes;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function hourOptions(el: EcoseeTimePickerOverlay): HTMLButtonElement[] {
  return [
    ...el.shadowRoot!.querySelectorAll('.column')[0]!.querySelectorAll('.option'),
  ] as HTMLButtonElement[];
}

function minuteOptions(el: EcoseeTimePickerOverlay): HTMLButtonElement[] {
  return [
    ...el.shadowRoot!.querySelectorAll('.column')[1]!.querySelectorAll('.option'),
  ] as HTMLButtonElement[];
}

describe('Time Picker overlay — seeding', () => {
  it('seeds the hour and minute columns from the given minutes-since-midnight value', async () => {
    const el = await mount(9 * 60 + 30); // 09:30
    const selectedHour = hourOptions(el).find((o) => o.classList.contains('selected'));
    const selectedMinute = minuteOptions(el).find((o) => o.classList.contains('selected'));
    expect(selectedHour?.textContent?.trim()).toBe('09');
    expect(selectedMinute?.textContent?.trim()).toBe('30');
  });

  it('lists 24 hour rows (00-23) and exactly 2 minute rows (00, 30)', async () => {
    const el = await mount();
    expect(hourOptions(el)).toHaveLength(24);
    const minuteLabels = minuteOptions(el).map((o) => o.textContent?.trim());
    expect(minuteLabels).toEqual(['00', '30']);
  });
});

describe('Time Picker overlay — selection', () => {
  it('tapping an hour row updates the selected hour without emitting confirm', async () => {
    const el = await mount(8 * 60);
    let fired = false;
    el.addEventListener('ecosee-time-picker-confirm', () => (fired = true));

    const seventeen = hourOptions(el).find((o) => o.textContent?.trim() === '17')!;
    seventeen.click();
    await el.updateComplete;

    expect(seventeen.classList.contains('selected')).toBe(true);
    expect(fired).toBe(false);
  });

  it('tapping a minute row updates the selected minute without emitting confirm', async () => {
    const el = await mount(8 * 60);
    let fired = false;
    el.addEventListener('ecosee-time-picker-confirm', () => (fired = true));

    const thirty = minuteOptions(el).find((o) => o.textContent?.trim() === '30')!;
    thirty.click();
    await el.updateComplete;

    expect(thirty.classList.contains('selected')).toBe(true);
    expect(fired).toBe(false);
  });

  it('only one hour row is selected at a time', async () => {
    const el = await mount(8 * 60);
    hourOptions(el)
      .find((o) => o.textContent?.trim() === '17')!
      .click();
    await el.updateComplete;

    const selected = hourOptions(el).filter((o) => o.classList.contains('selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent?.trim()).toBe('17');
  });
});

describe('Time Picker overlay — confirm', () => {
  it('emits ecosee-time-picker-confirm with the combined hour+minute value when Confirm is tapped', async () => {
    const el = await mount(8 * 60);
    let detail: { minutes: number } | undefined;
    el.addEventListener('ecosee-time-picker-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    hourOptions(el)
      .find((o) => o.textContent?.trim() === '17')!
      .click();
    await el.updateComplete;
    minuteOptions(el)
      .find((o) => o.textContent?.trim() === '30')!
      .click();
    await el.updateComplete;
    (el.shadowRoot!.querySelector('.confirm') as HTMLButtonElement).click();

    expect(detail).toEqual({ minutes: 17 * 60 + 30 });
  });

  it('confirms the seeded value unchanged if the user taps Confirm without picking anything', async () => {
    const el = await mount(6 * 60 + 30);
    let detail: { minutes: number } | undefined;
    el.addEventListener('ecosee-time-picker-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (el.shadowRoot!.querySelector('.confirm') as HTMLButtonElement).click();

    expect(detail).toEqual({ minutes: 6 * 60 + 30 });
  });
});
