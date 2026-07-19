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

  // Regression guard: with the loop rendering every value's row LOOP_COPIES
  // times, marking .selected purely by *value* (the original approach) lit
  // every repeat at once — harmless for Hour (24 values, repeats are far
  // apart), but the Minute column has only 2 values, so two different
  // copies of the same value can both sit inside the same 3-row viewport
  // and both light up. Selection is tracked per *copy* (`_hourCopy`/
  // `_minuteCopy`) instead, so exactly one physical row is ever marked,
  // regardless of how many other rows happen to share its value.
  it('marks exactly the tapped copy of a value as selected, not every repeat of it', async () => {
    const el = await mount(8 * 60);
    const seventeens = hourOptions(el).filter((o) => o.textContent?.trim() === '17');
    expect(seventeens.length).toBeGreaterThan(1); // several repeats exist in the DOM

    seventeens[0]!.click();
    await el.updateComplete;

    const selected = hourOptions(el).filter((o) => o.classList.contains('selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(seventeens[0]);
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

  // The Minute column's own reported case: only 2 distinct values, so every
  // *other* row in the DOM shares a value with some other row — exactly one
  // must still ever be marked selected.
  it('marks exactly one Minute row as selected, even though every other row shares one of only 2 values', async () => {
    const el = await mount(8 * 60); // seeded 08:00
    const selected = minuteOptions(el).filter((o) => o.classList.contains('selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent?.trim()).toBe('00');
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
// looping feature. The trigger compares the *viewport's edges*
// (scrollTop, scrollTop + clientHeight) against the first/last copy
// boundary, not a fixed offset from scrollTop alone — see the function's
// own doc comment for why (the Minute column's reported bug: only 2
// values meant clientHeight was a large fraction of one whole copy's
// height, so the old fixed-offset threshold sat beyond the scrollable
// range and the down-loop could never trigger).
describe('loopScrollTop', () => {
  const COPIES = 5;
  const SCROLL_HEIGHT = 1000; // 5 copies of 200px each
  const LOOP_HEIGHT = SCROLL_HEIGHT / COPIES; // 200
  const CLIENT_HEIGHT = 80; // a viewport comfortably smaller than one copy

  it('leaves scrollTop unchanged comfortably inside the middle copies', () => {
    // Copy 2 (the center, 0-indexed) spans [400, 600).
    expect(loopScrollTop(500, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(500);
  });

  it('wraps forward by one loop height once the viewport’s top edge scrolls into the first copy', () => {
    expect(loopScrollTop(50, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(50 + LOOP_HEIGHT);
  });

  it('wraps backward by one loop height once the viewport’s bottom edge scrolls into the last copy', () => {
    // Bottom edge at 750 + 80 = 830, past the last-copy boundary at 800.
    const scrollTop = 750;
    expect(loopScrollTop(scrollTop, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(
      scrollTop - LOOP_HEIGHT,
    );
  });

  it('does not wrap right at the top boundary — only once the top edge is past it', () => {
    expect(loopScrollTop(LOOP_HEIGHT, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(LOOP_HEIGHT);
    expect(loopScrollTop(LOOP_HEIGHT - 1, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(
      LOOP_HEIGHT - 1 + LOOP_HEIGHT,
    );
  });

  it('does not wrap right at the bottom boundary — only once the bottom edge is past it', () => {
    // Bottom edge exactly at the boundary (scrollHeight - loopHeight = 800): no wrap.
    const atBoundary = SCROLL_HEIGHT - LOOP_HEIGHT - CLIENT_HEIGHT; // 720 (+80 = 800)
    expect(loopScrollTop(atBoundary, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(atBoundary);
    expect(loopScrollTop(atBoundary + 1, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES)).toBe(
      atBoundary + 1 - LOOP_HEIGHT,
    );
  });

  it('is a no-op when scrollHeight is non-positive (no real layout yet)', () => {
    expect(loopScrollTop(100, 0, CLIENT_HEIGHT, COPIES)).toBe(100);
    expect(loopScrollTop(100, -50, CLIENT_HEIGHT, COPIES)).toBe(100);
  });

  // Regression guard for the reported bug: a column with very few distinct
  // values (the Minute column: just 00/30) has a clientHeight that is a
  // large fraction of one copy's height. The down-loop must still be
  // reachable within [0, scrollHeight - clientHeight] — it wasn't, before
  // the edge-aware trigger, because the old threshold assumed clientHeight
  // was small relative to a loop.
  it('the down-loop is reachable even when clientHeight is a large fraction of one copy’s height', () => {
    // 2 values * 5 copies * 20px rows = 200px scrollHeight; a viewport
    // showing ~4 of the 10 total rows (80px) — mirrors the Minute column.
    const scrollHeight = 200;
    const clientHeight = 80;
    const copies = 5;
    const loopHeight = scrollHeight / copies; // 40
    const maxScrollTop = scrollHeight - clientHeight; // 120 — the real ceiling
    // The old fixed threshold (loopHeight * (copies - 0.5) = 180) was past
    // maxScrollTop entirely, so the down-loop could never fire. The new
    // edge-aware threshold triggers at scrollTop > 80, well within [0, 120].
    const scrollTop = 100;
    expect(scrollTop).toBeLessThanOrEqual(maxScrollTop);
    expect(loopScrollTop(scrollTop, scrollHeight, clientHeight, copies)).toBe(
      scrollTop - loopHeight,
    );
  });

  it('always lands within the safe middle range after a single wrap', () => {
    // A single wrap from anywhere near the top or bottom edge must land
    // inside [loopHeight, scrollHeight - loopHeight - clientHeight] terms
    // that don't immediately re-trigger another wrap on the very next
    // scroll event.
    for (const scrollTop of [
      0,
      10,
      99,
      SCROLL_HEIGHT - CLIENT_HEIGHT - 1,
      SCROLL_HEIGHT - CLIENT_HEIGHT - 10,
    ]) {
      const result = loopScrollTop(scrollTop, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result + CLIENT_HEIGHT).toBeLessThanOrEqual(SCROLL_HEIGHT);
    }
  });

  // Regression guard for the reported flicker: a single native `scroll`
  // event can span more distance than one loopHeight covers when the
  // browser throttles/batches dispatches (routine on mobile, especially for
  // a short-cycling column like Minute where loopHeight itself is small). A
  // single-step correction used to under-shoot in that case, leaving the
  // scrollTop — and the tracked "selected" copy derived from it — briefly
  // wrong until later events caught up, visible as the highlight hopping
  // across rows.
  it('corrects a drift spanning several loop heights in one call, not just one step', () => {
    // Three loopHeights *before* the trigger threshold — as if a throttled
    // scroll event delivered a big jump in one go. A single-step correction
    // (5 - 3*200 = -595, +200 once = -395) would still land nowhere near
    // safe; only repeated correction reaches the safe zone in one call.
    const scrollTop = 5 - 3 * LOOP_HEIGHT;
    const result = loopScrollTop(scrollTop, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES);
    expect(result).toBeGreaterThanOrEqual(LOOP_HEIGHT);
    expect(result + CLIENT_HEIGHT).toBeLessThanOrEqual(SCROLL_HEIGHT - LOOP_HEIGHT);
    // Same visual content either way — the correction is always a whole
    // number of loopHeights.
    expect((result - scrollTop) % LOOP_HEIGHT).toBe(0);
  });

  it('corrects a large drift in the backward direction the same way', () => {
    // Three loopHeights *past* the trigger threshold on the bottom edge.
    const scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 5 + 3 * LOOP_HEIGHT;
    const result = loopScrollTop(scrollTop, SCROLL_HEIGHT, CLIENT_HEIGHT, COPIES);
    expect(result).toBeGreaterThanOrEqual(LOOP_HEIGHT);
    expect(result + CLIENT_HEIGHT).toBeLessThanOrEqual(SCROLL_HEIGHT - LOOP_HEIGHT);
    expect((scrollTop - result) % LOOP_HEIGHT).toBe(0);
  });

  it('never loops forever on a degenerate config with no safe position', () => {
    // clientHeight bigger than the whole scrollable range: no scrollTop can
    // ever satisfy both edge conditions. The iteration cap must still return
    // a finite number, not hang.
    expect(() => loopScrollTop(5, 100, 1000, COPIES)).not.toThrow();
    expect(Number.isFinite(loopScrollTop(5, 100, 1000, COPIES))).toBe(true);
  });
});
