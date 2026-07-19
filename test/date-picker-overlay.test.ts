// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import '../src/overlays/date-picker-overlay';
import type { EcoseeDatePickerOverlay } from '../src/overlays/date-picker-overlay';

// ecosee's own calendar date picker (ADR-0018), replacing the browser's native
// <input type="date"> picker for Furnace Filter's Last Changed field. Tapping
// any valid day confirms and closes immediately (owner decision) — the shell's
// own ✕ is the only way to back out without picking anything.

async function mount(
  overrides: Partial<Pick<EcoseeDatePickerOverlay, 'value' | 'max' | 'label'>> = {},
): Promise<EcoseeDatePickerOverlay> {
  const el = document.createElement('ecosee-date-picker-overlay') as EcoseeDatePickerOverlay;
  if (overrides.value) el.value = overrides.value;
  if (overrides.max) el.max = overrides.max;
  if (overrides.label) el.label = overrides.label;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function dayButtons(el: EcoseeDatePickerOverlay): HTMLButtonElement[] {
  return [...el.shadowRoot!.querySelectorAll('.day')] as HTMLButtonElement[];
}

function dayButton(el: EcoseeDatePickerOverlay, dayNumber: number): HTMLButtonElement {
  return dayButtons(el).find((b) => b.textContent?.trim() === String(dayNumber))!;
}

describe('Date Picker overlay — rendering', () => {
  it('opens on the selected value’s own month', async () => {
    const el = await mount({ value: new Date(2026, 2, 10) }); // March 10, 2026
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toContain('March 2026');
  });

  it('opens on today’s month when no value is given', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toContain('June 2026');
  });

  it('renders exactly the days in the current month as tappable buttons', async () => {
    const el = await mount({ value: new Date(2026, 5, 15) }); // June has 30 days
    expect(dayButtons(el)).toHaveLength(30);
  });

  it('marks the selected value’s day', async () => {
    const el = await mount({ value: new Date(2026, 5, 15) });
    expect(dayButton(el, 15).classList.contains('selected')).toBe(true);
    expect(dayButton(el, 14).classList.contains('selected')).toBe(false);
  });

  it('renders the custom label', async () => {
    const el = await mount({ label: 'Last Changed' });
    expect(el.shadowRoot!.querySelector('.title')?.textContent?.trim()).toBe('Last Changed');
  });
});

describe('Date Picker overlay — future-date gating (max)', () => {
  it('disables days after max within the same month', async () => {
    const el = await mount({ value: new Date(2026, 5, 10), max: new Date(2026, 5, 15) });
    expect(dayButton(el, 16).disabled).toBe(true);
    expect(dayButton(el, 15).disabled).toBe(false);
  });

  it('disables the "next month" button once the view is already on max’s month', async () => {
    const el = await mount({ value: new Date(2026, 5, 10), max: new Date(2026, 5, 15) });
    const next = el.shadowRoot!.querySelector('[aria-label="Next month"]') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('does not disable any day when max is absent', async () => {
    const el = await mount({ value: new Date(2026, 5, 10) });
    for (const btn of dayButtons(el)) expect(btn.disabled).toBe(false);
  });
});

describe('Date Picker overlay — month navigation', () => {
  it('moves to the next month on tapping the next chevron', async () => {
    const el = await mount({ value: new Date(2026, 5, 10) });
    (el.shadowRoot!.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toContain('July 2026');
  });

  it('moves to the previous month on tapping the previous chevron', async () => {
    const el = await mount({ value: new Date(2026, 5, 10) });
    (el.shadowRoot!.querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toContain('May 2026');
  });

  it('rolls over the year boundary when paging past December/January', async () => {
    const el = await mount({ value: new Date(2026, 11, 10) }); // December 2026
    (el.shadowRoot!.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.month-label')?.textContent).toContain('January 2027');
  });
});

describe('Date Picker overlay — confirm', () => {
  it('emits ecosee-date-picker-confirm with the tapped day when a day is tapped', async () => {
    const el = await mount({ value: new Date(2026, 5, 10) });
    let detail: { date: Date } | undefined;
    el.addEventListener('ecosee-date-picker-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    dayButton(el, 22).click();

    expect(detail?.date.getFullYear()).toBe(2026);
    expect(detail?.date.getMonth()).toBe(5);
    expect(detail?.date.getDate()).toBe(22);
  });

  it('emits the correct date after navigating to a different month first', async () => {
    const el = await mount({ value: new Date(2026, 5, 10) });
    let detail: { date: Date } | undefined;
    el.addEventListener('ecosee-date-picker-confirm', (event) => {
      detail = (event as CustomEvent).detail;
    });

    (el.shadowRoot!.querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
    await el.updateComplete;
    dayButton(el, 5).click(); // May 5, 2026

    expect(detail?.date.getMonth()).toBe(4);
    expect(detail?.date.getDate()).toBe(5);
  });

  it('does not emit confirm when a disabled (future) day is clicked', async () => {
    const el = await mount({ value: new Date(2026, 5, 10), max: new Date(2026, 5, 15) });
    let fired = false;
    el.addEventListener('ecosee-date-picker-confirm', () => (fired = true));

    dayButton(el, 20).click();

    expect(fired).toBe(false);
  });
});
