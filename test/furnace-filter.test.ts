import { describe, it, expect } from 'vitest';
import {
  toFurnaceFilterModel,
  markFilterChangedCall,
  setLastChangedDateCall,
  formatIntervalUnit,
} from '../src/climate/furnace-filter';
import type { EcoseeCardConfig } from '../src/config';
import type { HassEntityBase, HomeAssistant } from '../src/types/hass';

// Unit tests for the Furnace Filter Main Menu section's derivation seam
// (owner request: last-changed date, interval, a big "I've changed my
// filter" button — config-driven since the backing entities vary per user's
// own integration/helper setup).

function hass(entities: HassEntityBase[]): HomeAssistant {
  const states: Record<string, HassEntityBase> = {};
  for (const e of entities) states[e.entity_id] = e;
  return {
    states,
    config: { unit_system: { temperature: '°F' } },
    callService: async () => undefined,
  };
}

function entity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntityBase {
  return { entity_id, state, attributes };
}

const BASE_CONFIG: EcoseeCardConfig = { type: 'custom:ecosee-card', entity: 'climate.t' };

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('toFurnaceFilterModel — availability', () => {
  it('is unavailable when filter_last_changed_entity is unset', () => {
    const model = toFurnaceFilterModel(hass([]), BASE_CONFIG);
    expect(model.available).toBe(false);
  });

  it('is unavailable when the configured entity is missing from hass', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([]), config);
    expect(model.available).toBe(false);
  });

  it('is unavailable when the entity reports unavailable/unknown', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([entity('date.filter', 'unavailable')]), config);
    expect(model.available).toBe(false);
  });

  it('is unavailable when the entity state does not parse as a date', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'sensor.filter' };
    const model = toFurnaceFilterModel(hass([entity('sensor.filter', 'garbage')]), config);
    expect(model.available).toBe(false);
  });

  it('parses a date-domain entity’s plain YYYY-MM-DD state', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(10))]), config);
    expect(model.available).toBe(true);
    expect(model.lastChanged).not.toBeNull();
  });

  it('parses an input_datetime’s space-separated datetime state', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'input_datetime.filter' };
    const model = toFurnaceFilterModel(
      hass([entity('input_datetime.filter', `${daysAgo(5)} 00:00:00`)]),
      config,
    );
    expect(model.available).toBe(true);
    expect(model.lastChanged).not.toBeNull();
  });
});

describe('toFurnaceFilterModel — interval and due date', () => {
  it('has no due date / overdue state when no interval is configured', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(200))]), config);
    expect(model.intervalDays).toBeNull();
    expect(model.dueDate).toBeNull();
    expect(model.overdue).toBe(false);
  });

  it('is not overdue when within filter_interval_days', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 90,
    };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(10))]), config);
    expect(model.intervalDays).toBe(90);
    expect(model.overdue).toBe(false);
  });

  it('is overdue past filter_interval_days, with a whole-day daysOverdue count', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 90,
    };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(95))]), config);
    expect(model.overdue).toBe(true);
    expect(model.daysOverdue).toBe(5);
  });

  it('prefers a valid filter_interval_entity reading over filter_interval_days', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 90,
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([entity('date.filter', daysAgo(10)), entity('number.filter_interval', '30')]),
      config,
    );
    expect(model.intervalDays).toBe(30);
  });

  it('falls back to filter_interval_days when filter_interval_entity is unavailable', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 90,
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([entity('date.filter', daysAgo(10)), entity('number.filter_interval', 'unavailable')]),
      config,
    );
    expect(model.intervalDays).toBe(90);
  });
});

describe('toFurnaceFilterModel — filter_interval_entity unit_of_measurement (months/weeks)', () => {
  // Real-world shape reported by an owner: a `number` helper named "Furnace
  // Filter Reminder Interval" with min 1 / max 12 / step 1 and
  // unit_of_measurement "months" — previously misread as 90 raw days for a
  // reading of "90", when it actually means 90 months.
  it('reads a "months" unit calendar-correctly, not as a ~30-day approximation', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const lastChangedState = daysAgo(10);
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', lastChangedState),
        entity('number.filter_interval', '3', { unit_of_measurement: 'months' }),
      ]),
      config,
    );
    const [y, m, d] = lastChangedState.split('-').map(Number);
    const expectedDue = new Date(y, m - 1, d);
    expectedDue.setMonth(expectedDue.getMonth() + 3);
    expect(model.dueDate?.getTime()).toBe(expectedDue.getTime());
    // Not the flat 90-day approximation three months would round to.
    expect(model.intervalDays).not.toBe(90);
  });

  it('matches the exact real-world entity shape (months, friendly_name, min/max/step)', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.furnace_filter_reminder_interval',
    };
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(400)),
        entity('number.furnace_filter_reminder_interval', '6', {
          min: 1,
          max: 12,
          step: 1,
          mode: 'box',
          unit_of_measurement: 'months',
          friendly_name: 'Thermostat Furnace Filter Reminder Interval',
        }),
      ]),
      config,
    );
    // 400 days ago + 6 months is comfortably overdue, however the months are
    // converted — this asserts the overdue *conclusion*, not a specific count.
    expect(model.overdue).toBe(true);
  });

  it('recognizes month unit variants case-insensitively (Months, MO)', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    for (const unit of ['Months', 'MO', 'mo.', 'mos']) {
      const model = toFurnaceFilterModel(
        hass([
          entity('date.filter', daysAgo(10)),
          entity('number.filter_interval', '2', { unit_of_measurement: unit }),
        ]),
        config,
      );
      const expected = new Date();
      expected.setDate(expected.getDate() - 10);
      expected.setHours(0, 0, 0, 0);
      expected.setMonth(expected.getMonth() + 2);
      expect(model.dueDate?.getTime()).toBe(expected.getTime());
    }
  });

  it('reads a "weeks" unit as 7-day multiples', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(10)),
        entity('number.filter_interval', '4', { unit_of_measurement: 'weeks' }),
      ]),
      config,
    );
    expect(model.intervalDays).toBe(28);
  });

  it('treats an unset or unrecognized unit as days, unchanged from before', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const noUnit = toFurnaceFilterModel(
      hass([entity('date.filter', daysAgo(10)), entity('number.filter_interval', '45')]),
      config,
    );
    expect(noUnit.intervalDays).toBe(45);
    const oddUnit = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(10)),
        entity('number.filter_interval', '45', { unit_of_measurement: '°F' }),
      ]),
      config,
    );
    expect(oddUnit.intervalDays).toBe(45);
  });

  it('a plain filter_interval_days config value is always read as days', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 6,
    };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(10))]), config);
    expect(model.intervalDays).toBe(6);
  });
});

describe('toFurnaceFilterModel — canMarkChanged', () => {
  it('is true when filter_reset_entity is configured, regardless of filter_last_changed_entity’s domain', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'sensor.filter',
      filter_reset_entity: 'button.reset_filter',
    };
    const model = toFurnaceFilterModel(hass([entity('sensor.filter', daysAgo(1))]), config);
    expect(model.canMarkChanged).toBe(true);
  });

  it('is true when filter_last_changed_entity is itself directly writable (date/datetime/input_datetime)', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(1))]), config);
    expect(model.canMarkChanged).toBe(true);
  });

  it('is false when filter_last_changed_entity is read-only and no reset entity is configured', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'sensor.filter' };
    const model = toFurnaceFilterModel(hass([entity('sensor.filter', daysAgo(1))]), config);
    expect(model.canMarkChanged).toBe(false);
  });
});

describe('markFilterChangedCall', () => {
  it('returns null when neither a reset entity nor a writable last-changed entity is configured', () => {
    expect(markFilterChangedCall('sensor.filter', undefined)).toBeNull();
  });

  it('returns null when nothing at all is configured', () => {
    expect(markFilterChangedCall(undefined, undefined)).toBeNull();
  });

  it('presses a button.* reset entity', () => {
    expect(markFilterChangedCall(undefined, 'button.reset_filter')).toEqual({
      domain: 'button',
      service: 'press',
      data: { entity_id: 'button.reset_filter' },
    });
  });

  it('turns on a script.* reset entity', () => {
    expect(markFilterChangedCall(undefined, 'script.reset_filter')).toEqual({
      domain: 'script',
      service: 'turn_on',
      data: { entity_id: 'script.reset_filter' },
    });
  });

  it('writes today onto a date.* last-changed entity via date.set_value', () => {
    const call = markFilterChangedCall('date.filter', undefined);
    expect(call?.domain).toBe('date');
    expect(call?.service).toBe('set_value');
    expect(call?.data.entity_id).toBe('date.filter');
    expect(call?.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('writes today onto an input_datetime.* last-changed entity via input_datetime.set_datetime', () => {
    const call = markFilterChangedCall('input_datetime.filter', undefined);
    expect(call?.domain).toBe('input_datetime');
    expect(call?.service).toBe('set_datetime');
    expect(call?.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('writes today onto a datetime.* last-changed entity via datetime.set_value, as a UTC ISO timestamp', () => {
    const call = markFilterChangedCall('datetime.filter', undefined);
    expect(call?.domain).toBe('datetime');
    expect(call?.service).toBe('set_value');
    expect(typeof call?.data.datetime).toBe('string');
    expect(new Date(call!.data.datetime as string).getTime()).not.toBeNaN();
  });

  it('prefers filter_reset_entity even when filter_last_changed_entity is also directly writable', () => {
    expect(markFilterChangedCall('date.filter', 'button.reset_filter')?.domain).toBe('button');
  });
});

describe('setLastChangedDateCall — manual date editing', () => {
  it('writes an arbitrary picked date onto a date.* entity', () => {
    const picked = new Date(2026, 0, 15);
    const call = setLastChangedDateCall('date.filter', picked);
    expect(call).toEqual({
      domain: 'date',
      service: 'set_value',
      data: { entity_id: 'date.filter', date: '2026-01-15' },
    });
  });

  it('writes an arbitrary picked date onto an input_datetime.* entity', () => {
    const picked = new Date(2025, 11, 3);
    const call = setLastChangedDateCall('input_datetime.filter', picked);
    expect(call).toEqual({
      domain: 'input_datetime',
      service: 'set_datetime',
      data: { entity_id: 'input_datetime.filter', date: '2025-12-03' },
    });
  });

  it('returns null for a read-only sensor — never falls back to a reset entity', () => {
    expect(setLastChangedDateCall('sensor.filter', new Date())).toBeNull();
  });
});

describe('toFurnaceFilterModel — canEditLastChanged / intervalEdit', () => {
  it('canEditLastChanged is true for a directly-writable entity domain, independent of filter_reset_entity', () => {
    const config = { ...BASE_CONFIG, filter_last_changed_entity: 'date.filter' };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(1))]), config);
    expect(model.canEditLastChanged).toBe(true);
  });

  it('canEditLastChanged is false for a read-only sensor even with a reset entity configured', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'sensor.filter',
      filter_reset_entity: 'button.reset_filter',
    };
    const model = toFurnaceFilterModel(hass([entity('sensor.filter', daysAgo(1))]), config);
    // canMarkChanged is still true (the button works), but manual date editing isn't possible.
    expect(model.canMarkChanged).toBe(true);
    expect(model.canEditLastChanged).toBe(false);
  });

  it('intervalEdit is null when no filter_interval_entity is configured, even with filter_interval_days set', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_days: 90,
    };
    const model = toFurnaceFilterModel(hass([entity('date.filter', daysAgo(1))]), config);
    expect(model.intervalEdit).toBeNull();
  });

  it('intervalEdit carries the raw entity value, resolved unit, and a dropdown of options across the entity’s min/max/step', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(1)),
        entity('number.filter_interval', '6', {
          min: 1,
          max: 12,
          step: 1,
          unit_of_measurement: 'months',
        }),
      ]),
      config,
    );
    expect(model.intervalEdit?.entityId).toBe('number.filter_interval');
    expect(model.intervalEdit?.value).toBe(6);
    expect(model.intervalEdit?.unit).toBe('months');
    expect(model.intervalEdit?.options.map((o) => o.value)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(model.intervalEdit?.options.map((o) => o.label)).toEqual([
      '1 month',
      '2 months',
      '3 months',
      '4 months',
      '5 months',
      '6 months',
      '7 months',
      '8 months',
      '9 months',
      '10 months',
      '11 months',
      '12 months',
    ]);
    expect(model.intervalEdit?.options.filter((o) => o.selected)).toEqual([
      { value: 6, label: '6 months', selected: true },
    ]);
  });

  it('falls back to default bounds (1..24 by 1) when the entity omits min/max/step', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(1)),
        entity('number.filter_interval', '3', { unit_of_measurement: 'weeks' }),
      ]),
      config,
    );
    expect(model.intervalEdit?.options).toHaveLength(24);
    expect(model.intervalEdit?.options[0]?.value).toBe(1);
    const options = model.intervalEdit?.options ?? [];
    expect(options[options.length - 1]?.value).toBe(24);
  });

  it('always includes the current value in options, even if it falls off the entity’s own step grid', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([
        entity('date.filter', daysAgo(1)),
        entity('number.filter_interval', '2.5', {
          min: 1,
          max: 12,
          step: 1,
          unit_of_measurement: 'months',
        }),
      ]),
      config,
    );
    expect(model.intervalEdit?.options.some((o) => o.value === 2.5 && o.selected)).toBe(true);
  });

  it('intervalEdit is null when filter_interval_entity is unavailable', () => {
    const config = {
      ...BASE_CONFIG,
      filter_last_changed_entity: 'date.filter',
      filter_interval_entity: 'number.filter_interval',
    };
    const model = toFurnaceFilterModel(
      hass([entity('date.filter', daysAgo(1)), entity('number.filter_interval', 'unavailable')]),
      config,
    );
    expect(model.intervalEdit).toBeNull();
  });
});

describe('formatIntervalUnit', () => {
  it('pluralizes correctly for each recognized unit', () => {
    expect(formatIntervalUnit(1, 'months')).toBe('1 month');
    expect(formatIntervalUnit(3, 'months')).toBe('3 months');
    expect(formatIntervalUnit(1, 'weeks')).toBe('1 week');
    expect(formatIntervalUnit(2, 'weeks')).toBe('2 weeks');
    expect(formatIntervalUnit(1, 'days')).toBe('1 day');
    expect(formatIntervalUnit(90, 'days')).toBe('90 days');
  });
});
