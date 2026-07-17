// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-schedule-overlay> via @customElement.
import '../src/overlays/schedule-overlay';
import type { EcoseeScheduleOverlay } from '../src/overlays/schedule-overlay';
import { scheduleDays } from '../src/schedule/schedule';
import type { ScheduleModel } from '../src/schedule/schedule';

// Render tests for the Schedule day strip's "today" mark (owner report: "can
// you put an indicator so we know what day it currently is") — a small dot
// beneath the day letter, independent of .selected (the day being viewed,
// which the user can navigate away from without today itself changing).

function model(selectedIndex: number): ScheduleModel {
  return { available: true, days: scheduleDays(selectedIndex), blocks: [] };
}

async function mount(m: ScheduleModel, todayIndex: number): Promise<EcoseeScheduleOverlay> {
  const el = document.createElement('ecosee-schedule-overlay') as EcoseeScheduleOverlay;
  el.model = m;
  el.todayIndex = todayIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function dayCols(el: EcoseeScheduleOverlay): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll('.day-col')] as HTMLElement[];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Schedule day strip — today indicator', () => {
  it('shows the dot only under today’s column when viewing a different day', async () => {
    // Selected = Wednesday (3), today = Friday (5).
    const el = await mount(model(3), 5);
    const cols = dayCols(el);
    expect(cols).toHaveLength(7);
    cols.forEach((col, index) => {
      const dot = col.querySelector('.today-dot')!;
      expect(dot.classList.contains('hidden')).toBe(index !== 5);
    });
  });

  it('shows the dot on the selected day when today is also the viewed day', async () => {
    const el = await mount(model(2), 2);
    const cols = dayCols(el);
    const dot = cols[2].querySelector('.today-dot')!;
    expect(dot.classList.contains('hidden')).toBe(false);
    expect(cols[2].querySelector('.day')!.classList.contains('selected')).toBe(true);
  });

  it('reserves the dot’s space on every column (visibility, not display none)', async () => {
    const el = await mount(model(0), 4);
    const cols = dayCols(el);
    // Every column still has the element in the DOM even when not "today".
    cols.forEach((col) => expect(col.querySelector('.today-dot')).not.toBeNull());
  });

  it('marks no day when todayIndex is unset (out-of-range default)', async () => {
    const el = await mount(model(0), -1);
    const cols = dayCols(el);
    cols.forEach((col) => {
      expect(col.querySelector('.today-dot')!.classList.contains('hidden')).toBe(true);
    });
  });

  it('adds ", today" to the accessible label only for today’s column', async () => {
    const el = await mount(model(0), 6);
    const cols = dayCols(el);
    expect(cols[6].querySelector('.day')!.getAttribute('aria-label')).toMatch(/, today$/);
    expect(cols[0].querySelector('.day')!.getAttribute('aria-label')).not.toMatch(/, today$/);
  });
});
