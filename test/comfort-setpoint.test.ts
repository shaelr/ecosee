import { describe, it, expect } from 'vitest';
import {
  toComfortSetpointsModel,
  setNumberValueCall,
  nudgeSetpoint,
  scrubSetpoint,
  formatSetpointValue,
} from '../src/climate/comfort-setpoint';
import type { EcoseeCardConfig, ComfortSetpointConfig } from '../src/config';
import type { HassEntityBase, HomeAssistant } from '../src/types/hass';
import type { SetpointEdit } from '../src/climate/temperature-adjust';

function hass(entities: HassEntityBase[]): HomeAssistant {
  const states: Record<string, HassEntityBase> = {};
  for (const entity of entities) states[entity.entity_id] = entity;
  return {
    states,
    config: { unit_system: { temperature: '°F' } },
    callService: async () => undefined,
  };
}

function numberEntity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntityBase {
  return { entity_id: entityId, state, attributes: { min: 40, max: 90, step: 0.5, ...attributes } };
}

const ROWS: ComfortSetpointConfig[] = [
  { preset: 'Home', heat_entity: 'number.home_heat', cool_entity: 'number.home_cool' },
  { preset: 'Away', heat_entity: 'number.away_heat' },
];

function config(rows: ComfortSetpointConfig[] = ROWS): EcoseeCardConfig {
  return { type: 'custom:ecosee-card', entity: 'climate.t', comfort_setpoints: rows };
}

describe('toComfortSetpointsModel', () => {
  it('is unavailable when comfort_setpoints is unset or empty', () => {
    expect(toComfortSetpointsModel(hass([]), { type: 'custom:ecosee-card', entity: 'climate.t' })).toEqual(
      { available: false, presets: [] },
    );
    expect(toComfortSetpointsModel(hass([]), config([])).available).toBe(false);
  });

  it('reads each configured field from its own number entity', () => {
    const model = toComfortSetpointsModel(
      hass([
        numberEntity('number.home_heat', '68'),
        numberEntity('number.home_cool', '75'),
        numberEntity('number.away_heat', '60'),
      ]),
      config(),
    );
    expect(model.available).toBe(true);
    expect(model.presets).toHaveLength(2);

    const home = model.presets.find((p) => p.preset === 'Home');
    expect(home?.label).toBe('Home');
    expect(home?.icon).toBe('home');
    expect(home?.heat).toEqual({
      entityId: 'number.home_heat',
      unit: '',
      edit: { setpoint: 'heat', value: 68, min: 40, max: 90, step: 0.5 },
    });
    expect(home?.cool?.edit.value).toBe(75);

    const away = model.presets.find((p) => p.preset === 'Away');
    expect(away?.heat?.entityId).toBe('number.away_heat');
    expect(away?.cool).toBeNull(); // no cool_entity configured for Away
  });

  it('resolves label/icon for custom preset names the same way the Comfort Setting picker does', () => {
    const model = toComfortSetpointsModel(
      hass([numberEntity('number.vacation_heat', '55')]),
      config([{ preset: 'Vacation', heat_entity: 'number.vacation_heat' }]),
    );
    expect(model.presets[0].label).toBe('Vacation');
    expect(model.presets[0].icon).toBe('comfort');
  });

  it('drops a field whose entity is missing or unavailable', () => {
    const model = toComfortSetpointsModel(
      hass([{ entity_id: 'number.home_heat', state: 'unavailable', attributes: {} }]),
      config([{ preset: 'Home', heat_entity: 'number.home_heat', cool_entity: 'number.missing' }]),
    );
    // Neither field resolves, so the whole preset is dropped.
    expect(model.presets).toHaveLength(0);
    expect(model.available).toBe(false);
  });

  it('drops a field whose state is non-numeric', () => {
    const model = toComfortSetpointsModel(
      hass([numberEntity('number.home_heat', 'not-a-number')]),
      config([{ preset: 'Home', heat_entity: 'number.home_heat' }]),
    );
    expect(model.presets).toHaveLength(0);
  });

  it('keeps a preset with only one usable field', () => {
    const model = toComfortSetpointsModel(
      hass([numberEntity('number.home_heat', '68')]),
      config([{ preset: 'Home', heat_entity: 'number.home_heat', cool_entity: 'number.missing' }]),
    );
    expect(model.presets).toHaveLength(1);
    expect(model.presets[0].heat).not.toBeNull();
    expect(model.presets[0].cool).toBeNull();
  });

  it('falls back to the default step when the entity omits one, and reads its own unit', () => {
    const model = toComfortSetpointsModel(
      hass([
        { entity_id: 'number.home_heat', state: '68', attributes: { unit_of_measurement: '°F' } },
      ]),
      config([{ preset: 'Home', heat_entity: 'number.home_heat' }]),
    );
    expect(model.presets[0].heat?.edit.step).toBe(0.5);
    expect(model.presets[0].heat?.unit).toBe('°F');
  });

  it('snap-clamps an out-of-grid or out-of-range reading into the entity’s own bounds', () => {
    const model = toComfortSetpointsModel(
      hass([numberEntity('number.home_heat', '95', { min: 40, max: 90, step: 1 })]),
      config([{ preset: 'Home', heat_entity: 'number.home_heat' }]),
    );
    expect(model.presets[0].heat?.edit.value).toBe(90);
  });
});

describe('formatSetpointValue', () => {
  it('shows a whole-step value with no decimal', () => {
    expect(formatSetpointValue(68)).toBe('68');
    expect(formatSetpointValue(69)).toBe('69');
  });

  it('shows a fractional-step value with exactly one decimal, never colliding with its neighbors', () => {
    // The bug this guards: formatTemp's whole-°F rounding would show 68.5 and
    // 69 as the same label ("69"), duplicating adjacent scrubber values.
    expect(formatSetpointValue(68.5)).toBe('68.5');
    expect(formatSetpointValue(69)).toBe('69');
    expect(formatSetpointValue(68.5)).not.toBe(formatSetpointValue(69));
  });
});

describe('setNumberValueCall', () => {
  it('builds a number.set_value call', () => {
    expect(setNumberValueCall('number.home_heat', 68.5)).toEqual({
      domain: 'number',
      service: 'set_value',
      data: { entity_id: 'number.home_heat', value: 68.5 },
    });
  });
});

const EDIT: SetpointEdit = { setpoint: 'heat', value: 68, min: 40, max: 90, step: 0.5 };

describe('nudgeSetpoint', () => {
  it('steps up and down by one step', () => {
    expect(nudgeSetpoint(EDIT, 1).value).toBe(68.5);
    expect(nudgeSetpoint(EDIT, -1).value).toBe(67.5);
  });

  it('clamps at the entity’s own bounds', () => {
    const atMax: SetpointEdit = { ...EDIT, value: 90 };
    expect(nudgeSetpoint(atMax, 1).value).toBe(90);
    const atMin: SetpointEdit = { ...EDIT, value: 40 };
    expect(nudgeSetpoint(atMin, -1).value).toBe(40);
  });
});

describe('scrubSetpoint', () => {
  it('maps downward drag distance to a raised value (inverted scrubber, matching temperature-adjust)', () => {
    // 22px per step (matching the picker's own PX_PER_STEP), 3 steps down.
    expect(scrubSetpoint(EDIT, 68, 66, 22).value).toBe(69.5);
  });

  it('maps upward drag to a lowered value', () => {
    expect(scrubSetpoint(EDIT, 68, -22, 22).value).toBe(67.5);
  });

  it('clamps the scrubbed value to bounds', () => {
    expect(scrubSetpoint(EDIT, 68, 10000, 22).value).toBe(90);
  });

  it('degrades to no movement for a non-positive pxPerStep', () => {
    expect(scrubSetpoint(EDIT, 68, 100, 0).value).toBe(68);
  });
});
