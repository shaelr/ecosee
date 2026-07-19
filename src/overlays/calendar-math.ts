/** A single day cell in a month's calendar grid. `date` is always local
 *  midnight (matching `schedule.ts`'s `dayStart` convention — the Card has no
 *  independent line on the Home Assistant server's timezone, so it assumes
 *  the dashboard is viewed from the same timezone as the thermostat itself).
 *  `inCurrentMonth` is false for the leading/trailing days borrowed from the
 *  adjacent month to fill out a full week row. */
export interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
}

/** Build a full month's calendar grid as weeks of 7 days (Sunday-first,
 *  matching `schedule.ts`'s own day strip), including the leading days from
 *  the previous month and trailing days from the next so every week row is
 *  always a complete 7 cells — never a ragged first/last row. `month` is
 *  0-indexed (January = 0), matching `Date`'s own convention. */
export function buildCalendarGrid(year: number, month: number): CalendarDay[][] {
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 (Sun) .. 6 (Sat)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: CalendarDay[] = [];

  // Leading days borrowed from the previous month.
  for (let i = startWeekday - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), inCurrentMonth: false });
  }

  // The month's own days.
  for (let day = 1; day <= daysInMonth; day++) {
    days.push({ date: new Date(year, month, day), inCurrentMonth: true });
  }

  // Trailing days from the next month, filling the grid out to a whole
  // number of weeks.
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1]!.date;
    days.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inCurrentMonth: false,
    });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/** True when `a` and `b` fall on the same local calendar day, ignoring
 *  time-of-day — the comparison every "is this the selected/today day" check
 *  in the date picker needs. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True when `date` is strictly after `max`'s own calendar day (time-of-day
 *  on both sides is ignored) — the "no future dates past today" gate the
 *  date picker's day cells use to disable tomorrow-and-later. */
export function isAfterDay(date: Date, max: Date): boolean {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const m = new Date(max.getFullYear(), max.getMonth(), max.getDate());
  return d.getTime() > m.getTime();
}
