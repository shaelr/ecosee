// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import '../src/overlays/time-picker-overlay';
import { loopScrollTop } from '../src/overlays/time-picker-overlay';
import type { EcoseeTimePickerOverlay } from '../src/overlays/time-picker-overlay';

// ecosee's own time picker (ADR-0018): two independent scrollable columns
// (Hour 00-23, Minute 00/30) plus an explicit Confirm button, replacing the
// browser's native <input type="time"> picker everywhere ecosee edits a time
// value. Both columns loop — each renders its values repeated 5x back to
// back, and scrolling into the first/last copy silently wraps back toward
// the middle (the standard infinite-carousel trick, since every copy is
// identical content).

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

  // The looping columns render each value 5x back to back (LOOP_COPIES), not
  // once — the row count and distinct-value set are what's worth asserting.
  it('renders each hour/minute value 5x (LOOP_COPIES) to support looping', async () => {
    const el = await mount();
    expect(hourOptions(el)).toHaveLength(24 * 5);
    expect(minuteOptions(el)).toHaveLength(2 * 5);
    const distinctHours = new Set(hourOptions(el).map((o) => o.textContent?.trim()));
    expect(distinctHours.size).toBe(24);
    const distinctMinutes = new Set(minuteOptions(el).map((o) => o.textContent?.trim()));
    expect(distinctMinutes).toEqual(new Set(['00', '30']));
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

  // Every copy of the current value carries .selected (not just the one
  // tapped) — intentional, since only one copy is ever in view at a time
  // once the loop keeps the scroll position away from the true edges.
  it('marks every copy of the selected hour, not just the one tapped', async () => {
    const el = await mount(8 * 60);
    hourOptions(el)
      .find((o) => o.textContent?.trim() === '17')!
      .click();
    await el.updateComplete;

    const selected = hourOptions(el).filter((o) => o.classList.contains('selected'));
    expect(selected).toHaveLength(5); // LOOP_COPIES
    for (const option of selected) expect(option.textContent?.trim()).toBe('17');
  });

  it('only ever one *distinct* hour value is selected at a time', async () => {
    const el = await mount(8 * 60);
    hourOptions(el)
      .find((o) => o.textContent?.trim() === '17')!
      .click();
    await el.updateComplete;

    const selectedValues = new Set(
      hourOptions(el)
        .filter((o) => o.classList.contains('selected'))
        .map((o) => o.textContent?.trim()),
    );
    expect(selectedValues).toEqual(new Set(['17']));
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

// loopScrollTop is the pure decision logic behind the loop, split out
// specifically so it's testable without a real browser layout engine —
// happy-dom (like jsdom) doesn't compute real scrollHeight/clientHeight
// values, so the DOM-level scroll behavior itself can't be meaningfully
// asserted here; this is the actual load-bearing test coverage for the
// looping feature.
describe('loopScrollTop', () => {
  const COPIES = 5;
  const SCROLL_HEIGHT = 1000; // 5 copies of 200px each
  const LOOP_HEIGHT = SCROLL_HEIGHT / COPIES; // 200

  it('leaves scrollTop unchanged comfortably inside the middle copies', () => {
    // Copy 2 (the center, 0-indexed) spans [400, 600).
    expect(loopScrollTop(500, SCROLL_HEIGHT, COPIES)).toBe(500);
  });

  it('wraps forward by one loop height once scrolled into the first copy', () => {
    // Deep in copy 0 (< half a loop height from the very top).
    expect(loopScrollTop(50, SCROLL_HEIGHT, COPIES)).toBe(50 + LOOP_HEIGHT);
  });

  it('wraps backward by one loop height once scrolled into the last copy', () => {
    // Deep in copy 4 (> half a loop height from the very bottom).
    const scrollTop = SCROLL_HEIGHT - 50; // 950
    expect(loopScrollTop(scrollTop, SCROLL_HEIGHT, COPIES)).toBe(scrollTop - LOOP_HEIGHT);
  });

  it('does not wrap right at the boundary — only once past the half-loop threshold', () => {
    // Exactly at the copy-0/copy-1 boundary's midpoint threshold (loopHeight * 0.5).
    const threshold = LOOP_HEIGHT * 0.5;
    expect(loopScrollTop(threshold, SCROLL_HEIGHT, COPIES)).toBe(threshold);
    expect(loopScrollTop(threshold - 1, SCROLL_HEIGHT, COPIES)).toBe(threshold - 1 + LOOP_HEIGHT);
  });

  it('is a no-op when scrollHeight is non-positive (no real layout yet)', () => {
    expect(loopScrollTop(100, 0, COPIES)).toBe(100);
    expect(loopScrollTop(100, -50, COPIES)).toBe(100);
  });

  it('always lands within the safe middle range after a single wrap', () => {
    // A single wrap from anywhere in copy 0 or copy 4 must land inside
    // [loopHeight * 0.5, loopHeight * (COPIES - 0.5)) — never immediately
    // re-triggering another wrap on the very next scroll event.
    for (const scrollTop of [0, 10, 99, SCROLL_HEIGHT - 1, SCROLL_HEIGHT - 10]) {
      const result = loopScrollTop(scrollTop, SCROLL_HEIGHT, COPIES);
      expect(result).toBeGreaterThanOrEqual(LOOP_HEIGHT * 0.5);
      expect(result).toBeLessThan(LOOP_HEIGHT * (COPIES - 0.5));
    }
  });
});
