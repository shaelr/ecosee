import type { EcoseeCardConfig } from '../config';
import type { ServiceCall } from './service-call';
import type { Setpoints } from './home-view';

// The Resume Schedule seam (opt-in, config `resume_program` — ADR-0012): mirrors the
// ecobee device's own manual-override → Resume Schedule affordance. Home Assistant
// has no portable notion of an active hold (ADR-0004), so this is necessarily
// best-effort and `ecobee`-integration-specific, gated behind an explicit config
// toggle rather than automatic integration detection — the user is asserting their
// bound entity backs `ecobee.resume_program`, not the Card guessing it.

/** Whether the Resume Schedule pill should show beneath the setpoint ovals.
 *  Requires the opt-in `resume_program` config toggle and active setpoints (nothing
 *  to resume from Off/Dry/Fan only). Then a best-effort hold check: the `ecobee`
 *  integration's `climate_mode` attribute is the *scheduled* comfort setting name;
 *  the standard `preset_mode` is what's *actually* active. They differ exactly when
 *  a manual override (a temperature hold, or a held Comfort Setting) is in effect.
 *  A bound entity that doesn't expose `climate_mode` (a non-ecobee `climate` entity,
 *  or a HomeKit-paired ecobee) can't be checked this way — rather than hide a
 *  control the user explicitly opted into, this degrades to "assume a hold" (see
 *  ADR-0012), the same trade-off `temperature_entity` / `humidity_entity` make for
 *  their own overrides. */
export function resumeAvailable(
  config: EcoseeCardConfig,
  setpoints: Setpoints | null,
  attrs: Record<string, unknown>,
): boolean {
  if (!config.resume_program || setpoints === null) return false;
  const climateMode = attrs.climate_mode;
  const presetMode = attrs.preset_mode;
  if (typeof climateMode !== 'string' || typeof presetMode !== 'string') return true;
  return climateMode !== presetMode;
}

/** Build the `ecobee.resume_program` call. `resume_all: false` clears only the
 *  active hold/event (the top of the ecobee event stack) — the same scope as
 *  tapping the device's own Resume Schedule ✕, not a full vacation/event purge. */
export function resumeProgramCall(entityId: string): ServiceCall {
  return {
    domain: 'ecobee',
    service: 'resume_program',
    data: { entity_id: entityId, resume_all: false },
  };
}
