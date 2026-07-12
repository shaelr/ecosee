import { describe, it, expect } from 'vitest';
import { resumeAvailable, resumeProgramCall } from '../src/climate/resume-schedule';
import type { EcoseeCardConfig } from '../src/config';
import type { Setpoints } from '../src/climate/home-view';

// Unit tests for the Resume Schedule seam (ADR-0012): `resumeAvailable`'s gating
// logic (the opt-in config toggle, active setpoints, and the best-effort
// climate_mode/preset_mode hold heuristic) and `resumeProgramCall`'s payload — both
// pure, so exercised directly against fabricated config/attrs rather than a full
// `hass` fixture.

const config = (overrides: Partial<EcoseeCardConfig> = {}): EcoseeCardConfig => ({
  type: 'custom:ecosee-card',
  entity: 'climate.t',
  ...overrides,
});

const SETPOINTS: Setpoints = { heat: 68, cool: 75 };

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
