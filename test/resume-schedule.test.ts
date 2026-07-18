import { describe, it, expect } from 'vitest';
import {
  resumeAvailable,
  resumeReserved,
  resumeProgramCall,
  resumeEndTime,
} from '../src/climate/resume-schedule';
import type { EcoseeCardConfig } from '../src/config';
import type { Setpoints } from '../src/climate/home-view';

// Unit tests for the Resume Schedule seam (ADR-0012): `resumeReserved`'s layout
// gating (the opt-in config toggle plus active setpoints, independent of the hold
// check — issue: the pill's appear/disappear was shifting the rest of the Home
// Screen cluster), `resumeAvailable`'s further gating (the best-effort
// climate_mode/preset_mode hold heuristic), and `resumeProgramCall`'s payload —
// all pure, so exercised directly against fabricated config/attrs rather than a
// full `hass` fixture.

const config = (overrides: Partial<EcoseeCardConfig> = {}): EcoseeCardConfig => ({
  type: 'custom:ecosee-card',
  entity: 'climate.t',
  ...overrides,
});

const SETPOINTS: Setpoints = { heat: 68, cool: 75 };

describe('resumeReserved — layout-slot gating', () => {
  it('is false when resume_program is unset, even with active setpoints', () => {
    expect(resumeReserved(config(), SETPOINTS)).toBe(false);
  });

  it('is false when resume_program is explicitly false', () => {
    expect(resumeReserved(config({ resume_program: false }), SETPOINTS)).toBe(false);
  });

  it('is false when there are no active setpoints, even with resume_program on', () => {
    expect(resumeReserved(config({ resume_program: true }), null)).toBe(false);
  });

  it('is true whenever resume_program is on and setpoints are active — independent of any hold state', () => {
    expect(resumeReserved(config({ resume_program: true }), SETPOINTS)).toBe(true);
  });
});

describe('resumeAvailable — implies resumeReserved', () => {
  it('is never true when resumeReserved would be false for the same inputs', () => {
    // A hold-looking attrs set, but resumeReserved's own gates (config off, or no
    // setpoints) still win — resumeAvailable must not short-circuit past them.
    const holdAttrs = { climate_mode: 'Home', preset_mode: 'temp' };
    expect(resumeAvailable(config(), SETPOINTS, holdAttrs)).toBe(false);
    expect(resumeAvailable(config({ resume_program: true }), null, holdAttrs)).toBe(false);
  });
});

describe('resumeAvailable — opt-in gating', () => {
  it('is false when resume_program is unset, even with setpoints and a clear hold signal', () => {
    expect(
      resumeAvailable(config(), SETPOINTS, { climate_mode: 'Home', preset_mode: 'temp' }),
    ).toBe(false);
  });

  it('is false when resume_program is explicitly false', () => {
    expect(
      resumeAvailable(config({ resume_program: false }), SETPOINTS, {
        climate_mode: 'Home',
        preset_mode: 'temp',
      }),
    ).toBe(false);
  });

  it('is false when there are no active setpoints, even with resume_program on', () => {
    expect(
      resumeAvailable(config({ resume_program: true }), null, {
        climate_mode: 'Home',
        preset_mode: 'temp',
      }),
    ).toBe(false);
  });
});

describe('resumeAvailable — best-effort hold detection', () => {
  const on = config({ resume_program: true });

  it('is true for a plain temperature hold (climate_mode set, preset_mode "temp")', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home', preset_mode: 'temp' })).toBe(
      true,
    );
  });

  it('is true when a different Comfort Setting is held than the one scheduled', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home', preset_mode: 'Away' })).toBe(
      true,
    );
  });

  it('is false when preset_mode matches the scheduled climate_mode (following the schedule)', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home', preset_mode: 'Home' })).toBe(
      false,
    );
  });

  it('degrades to "assume a hold" (true) when climate_mode is absent (non-ecobee / HomeKit entity)', () => {
    expect(resumeAvailable(on, SETPOINTS, { preset_mode: 'Home' })).toBe(true);
    expect(resumeAvailable(on, SETPOINTS, {})).toBe(true);
  });

  it('degrades to "assume a hold" (true) when preset_mode is absent', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home' })).toBe(true);
  });

  it('degrades to "assume a hold" (true) when either attribute is a non-string', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home', preset_mode: 5 })).toBe(true);
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: null, preset_mode: 'Home' })).toBe(true);
  });
});

// Regression guard: the real ecobee integration maps preset_mode's three built-in
// presets through HA's generic (lowercase) PRESET_HOME/PRESET_AWAY/PRESET_SLEEP
// constants, but leaves climate_mode as ecobee's own raw, capitalized comfort-setting
// name. A strict (case-sensitive) compare therefore reported a hold on every
// built-in preset even while perfectly on-schedule — the pill never cleared. These
// fixtures use the exact casing the real integration produces.
describe('resumeAvailable — case-insensitive comparison (real ecobee casing)', () => {
  const on = config({ resume_program: true });

  it.each(['Home', 'Away', 'Sleep'])(
    'is false on-schedule for the built-in %s preset (climate_mode capitalized, preset_mode lowercase)',
    (name) => {
      expect(
        resumeAvailable(on, SETPOINTS, { climate_mode: name, preset_mode: name.toLowerCase() }),
      ).toBe(false);
    },
  );

  it('is still true when a different built-in preset is genuinely held, despite the casing difference', () => {
    expect(resumeAvailable(on, SETPOINTS, { climate_mode: 'Home', preset_mode: 'away' })).toBe(
      true,
    );
  });

  it('is false on-schedule for a custom (unmapped) Comfort Setting name, unaffected either way', () => {
    expect(
      resumeAvailable(on, SETPOINTS, {
        climate_mode: 'Guest Mode',
        preset_mode: 'Guest Mode',
      }),
    ).toBe(false);
  });
});

describe('resumeEndTime — the personal ha-ecobee fork addition (ADR-0016 closing note)', () => {
  it('parses the real reported attribute shape (ISO 8601 with an explicit UTC offset)', () => {
    const date = resumeEndTime({ hold_end_time: '2026-07-18T23:00:00-04:00' });
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe(new Date('2026-07-18T23:00:00-04:00').toISOString());
  });

  it('is null when the attribute is absent — no active hold', () => {
    expect(resumeEndTime({})).toBeNull();
  });

  it('is null when the attribute is an empty string', () => {
    expect(resumeEndTime({ hold_end_time: '' })).toBeNull();
  });

  it('is null when the attribute is not a string (e.g. Python None serialized through)', () => {
    expect(resumeEndTime({ hold_end_time: null })).toBeNull();
  });

  it('is null when the attribute does not parse as a date', () => {
    expect(resumeEndTime({ hold_end_time: 'garbage' })).toBeNull();
  });

  // The integration deliberately omits hold_end_time for an indefinite hold
  // (its own endDate is a far-future placeholder, not a real expiry) — from
  // this seam's point of view that's indistinguishable from "no active hold
  // at all," which is the point: nothing here should ever surface a fabricated
  // expiry (ADR-0003).
  it('is null for an indefinite hold, exactly like a bound entity with no hold at all', () => {
    expect(resumeEndTime({ preset_mode: 'away_indefinitely' })).toBeNull();
  });
});

describe('resumeProgramCall', () => {
  it('targets the ecobee.resume_program service with the bound entity', () => {
    expect(resumeProgramCall('climate.living_room')).toEqual({
      domain: 'ecobee',
      service: 'resume_program',
      data: { entity_id: 'climate.living_room', resume_all: false },
    });
  });

  it('always scopes to the current hold only (resume_all: false), matching the device ✕', () => {
    expect(resumeProgramCall('climate.t').data.resume_all).toBe(false);
  });
});
