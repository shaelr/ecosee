import type { EcoseeCardConfig } from '../config';
import type { ServiceCall } from './service-call';
import type { Setpoints } from './home-view';

// The Resume Schedule seam (opt-in, config `resume_program` — ADR-0012): mirrors the
// ecobee device's own manual-override → Resume Schedule affordance. Home Assistant
// has no portable notion of an active hold (ADR-0004), so this is necessarily
// best-effort and `ecobee`-integration-specific, gated behind an explicit config
// toggle rather than automatic integration detection — the user is asserting their
// bound entity backs `ecobee.resume_program`, not the Card guessing it.
//
// `resumeEndTime` reads a further personal `ha-ecobee` fork addition
// (`hold_end_time`, ADR-0016's own closing note) under the same trust
// boundary — the entity is only ever read this way once `resume_program` has
// already asserted it's a real ecobee-backed thermostat.

/** Whether the Resume Schedule pill's layout slot is reserved at all — the opt-in
 *  `resume_program` config toggle plus active setpoints (nothing to resume from
 *  Off/Dry/Fan only) — regardless of whether the best-effort hold check in
 *  `resumeAvailable` currently says to actually show it. The Home Screen keeps
 *  this slot present (just visually hidden) whenever it's reserved, so the rest
 *  of the cluster (current temperature, setpoint ovals) never shifts as the hold
 *  check flips the pill on and off — only entities with `resume_program` unset,
 *  or with no active setpoints, skip the slot entirely. */
export function resumeReserved(config: EcoseeCardConfig, setpoints: Setpoints | null): boolean {
  return config.resume_program === true && setpoints !== null;
}

/** Whether the Resume Schedule pill should actually show (not just reserve its
 *  slot) beneath the setpoint ovals. Requires `resumeReserved` first, then a
 *  best-effort hold check: the `ecobee` integration's `climate_mode` attribute is
 *  the *scheduled* comfort setting name; the standard `preset_mode` is what's
 *  *actually* active. They differ exactly when a manual override (a temperature
 *  hold, or a held Comfort Setting) is in effect. Compared case-insensitively:
 *  the ecobee integration maps `preset_mode`'s three built-in presets through
 *  HA's generic (lowercase) `PRESET_HOME`/`PRESET_AWAY`/`PRESET_SLEEP` constants,
 *  but leaves `climate_mode` as ecobee's own raw, capitalized comfort-setting
 *  name ("Home") — so on-schedule "Home" vs "home" differ only by that casing,
 *  not by an actual hold, and a strict compare never cleared the pill for any of
 *  the three built-ins. A custom-named Comfort Setting passes through both
 *  attributes unchanged, so case-insensitivity is a no-op there. A bound entity
 *  that doesn't expose `climate_mode` (a non-ecobee `climate` entity, or a
 *  HomeKit-paired ecobee) can't be checked this way — rather than hide a control
 *  the user explicitly opted into, this degrades to "assume a hold" (see
 *  ADR-0012), the same trade-off `temperature_entity` / `humidity_entity` make
 *  for their own overrides. */
export function resumeAvailable(
  config: EcoseeCardConfig,
  setpoints: Setpoints | null,
  attrs: Record<string, unknown>,
): boolean {
  if (!resumeReserved(config, setpoints)) return false;
  const climateMode = attrs.climate_mode;
  const presetMode = attrs.preset_mode;
  if (typeof climateMode !== 'string' || typeof presetMode !== 'string') return true;
  return climateMode.toLowerCase() !== presetMode.toLowerCase();
}

/** The active hold's end time (ADR-0016's own closing note: "if HA's ecobee
 *  integration ever starts exposing a hold's end time, the pill gains a
 *  natural place to show it"). `hold_end_time` is a personal `ha-ecobee` fork
 *  addition, not (yet) in the upstream integration ADR-0003/0012/0016's own
 *  research confirmed never surfaces one — an `extra_state_attributes` string,
 *  ISO 8601 with an explicit UTC offset (e.g. `"2026-07-18T17:28:00-04:00"`),
 *  computed from the real active hold event's own `endDate`/`endTime`, not a
 *  guess. Deliberately absent (not a far-future placeholder) for an
 *  indefinite hold — exposing ecobee's own placeholder `endDate` as if it
 *  were a real expiry would be exactly the fabricated data ADR-0003 rules
 *  out, so there is nothing here to parse in that case either. `null` when
 *  absent, empty, or unparseable — the pill simply omits the "until" text
 *  rather than guessing, the same graceful-degradation stance every other
 *  optional reading in the Card takes (ADR-0001). */
export function resumeEndTime(attrs: Record<string, unknown>): Date | null {
  const raw = attrs.hold_end_time;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
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
