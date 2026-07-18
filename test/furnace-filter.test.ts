import { describe, it, expect } from 'vitest';
import { toFurnaceFilterModel, markFilterChangedCall } from '../src/climate/furnace-filter';
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
