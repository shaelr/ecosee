import { describe, it, expect } from 'vitest';
import { buildCalendarGrid, isSameDay, isAfterDay } from '../src/overlays/calendar-math';

describe('buildCalendarGrid', () => {
  it('returns whole weeks of 7 days each', () => {
    const weeks = buildCalendarGrid(2026, 5); // June 2026
    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it('starts the first week on Sunday, with leading days borrowed from the previous month', () => {
    // June 1, 2026 is a Monday, so the first week's Sunday cell is May 31.
    const weeks = buildCalendarGrid(2026, 5);
    const firstWeek = weeks[0]!;
    expect(firstWeek[0]!.date.getMonth()).toBe(4); // May
    expect(firstWeek[0]!.date.getDate()).toBe(31);
    expect(firstWeek[0]!.inCurrentMonth).toBe(false);
    expect(firstWeek[1]!.date.getMonth()).toBe(5); // June
    expect(firstWeek[1]!.date.getDate()).toBe(1);
    expect(firstWeek[1]!.inCurrentMonth).toBe(true);
  });

  it('fills trailing days from the next month to complete the last week', () => {
    // June 2026 has 30 days, ending on a Tuesday — the last week needs
    // Wed–Sat borrowed from July.
    const weeks = buildCalendarGrid(2026, 5);
    const lastWeek = weeks[weeks.length - 1]!;
    const trailing = lastWeek.filter((d) => !d.inCurrentMonth);
    expect(trailing.length).toBeGreaterThan(0);
    for (const day of trailing) {
      expect(day.date.getMonth()).toBe(6); // July
    }
  });

  it('includes every day of the month exactly once, marked inCurrentMonth', () => {
    const weeks = buildCalendarGrid(2026, 5);
    const inMonth = weeks.flat().filter((d) => d.inCurrentMonth);
    expect(inMonth).toHaveLength(30); // June has 30 days
    expect(inMonth[0]!.date.getDate()).toBe(1);
    expect(inMonth[inMonth.length - 1]!.date.getDate()).toBe(30);
  });

  it('handles a leap-year February correctly (29 days)', () => {
    const weeks = buildCalendarGrid(2028, 1); // 2028 is a leap year
    const inMonth = weeks.flat().filter((d) => d.inCurrentMonth);
    expect(inMonth).toHaveLength(29);
  });

  it('handles a non-leap-year February correctly (28 days)', () => {
    const weeks = buildCalendarGrid(2026, 1);
    const inMonth = weeks.flat().filter((d) => d.inCurrentMonth);
    expect(inMonth).toHaveLength(28);
  });

  it('handles a month that already starts on Sunday (no leading days needed)', () => {
    // November 1, 2026 is a Sunday.
    const weeks = buildCalendarGrid(2026, 10);
    const firstWeek = weeks[0]!;
    expect(firstWeek[0]!.inCurrentMonth).toBe(true);
    expect(firstWeek[0]!.date.getDate()).toBe(1);
  });

  it('handles a month that ends on Saturday (no trailing days needed)', () => {
    // August 2026 ends on Monday the 31st — pick a month ending Saturday instead:
    // October 2026 has 31 days, October 31 2026 is a Saturday.
    const weeks = buildCalendarGrid(2026, 9);
    const lastWeek = weeks[weeks.length - 1]!;
    expect(lastWeek[6]!.inCurrentMonth).toBe(true);
    expect(lastWeek[6]!.date.getDate()).toBe(31);
  });

  it('rolls over the year boundary correctly (December -> January)', () => {
    const weeks = buildCalendarGrid(2026, 11); // December 2026
    const lastWeek = weeks[weeks.length - 1]!;
    const trailing = lastWeek.filter((d) => !d.inCurrentMonth);
    for (const day of trailing) {
      if (day.date.getDate() <= 7) {
        expect(day.date.getFullYear()).toBe(2027);
        expect(day.date.getMonth()).toBe(0); // January
      }
    }
  });

  it('produces local-midnight Date objects, not UTC-shifted ones', () => {
    const weeks = buildCalendarGrid(2026, 5);
    const june1 = weeks.flat().find((d) => d.inCurrentMonth && d.date.getDate() === 1)!;
    expect(june1.date.getHours()).toBe(0);
    expect(june1.date.getMinutes()).toBe(0);
    expect(june1.date.getMonth()).toBe(5);
  });
});

describe('isSameDay', () => {
  it('is true for the same calendar day regardless of time-of-day', () => {
    expect(isSameDay(new Date(2026, 5, 15, 3, 0), new Date(2026, 5, 15, 23, 59))).toBe(true);
  });

  it('is false for different days', () => {
    expect(isSameDay(new Date(2026, 5, 15), new Date(2026, 5, 16))).toBe(false);
  });

  it('is false for the same day-of-month in a different month or year', () => {
    expect(isSameDay(new Date(2026, 5, 15), new Date(2026, 6, 15))).toBe(false);
    expect(isSameDay(new Date(2026, 5, 15), new Date(2027, 5, 15))).toBe(false);
  });
});

describe('isAfterDay', () => {
  it('is true when date falls strictly after max, ignoring time-of-day', () => {
    expect(isAfterDay(new Date(2026, 5, 16, 0, 0), new Date(2026, 5, 15, 23, 59))).toBe(true);
  });

  it('is false for the same calendar day, regardless of time-of-day ordering', () => {
    expect(isAfterDay(new Date(2026, 5, 15, 23, 59), new Date(2026, 5, 15, 0, 0))).toBe(false);
  });

  it('is false for a date before max', () => {
    expect(isAfterDay(new Date(2026, 5, 14), new Date(2026, 5, 15))).toBe(false);
  });
});
