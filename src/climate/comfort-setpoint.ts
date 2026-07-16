import type { HomeAssistant } from '../types/hass';
import type { EcoseeCardConfig } from '../config';
import { comfortIconFor, comfortLabelFor, type ComfortIcon } from './comfort-setting';
import { UNAVAILABLE } from './home-view';
import { num } from './parse';
import { snapClamp, type Setpoint, type SetpointEdit } from './temperature-adjust';
import type { ServiceCall } from './service-call';

// The derivation seam for the Comfort Setpoints Main Menu section (ADR-0015): a
// per-Comfort-Setting Heat/Cool temperature editor, distinct from the Temperature
// Adjust overlay's *live hold* (temperature-adjust.ts). Each field is backed by
// its own independent `number` entity (e.g. an ecobee integration's
// per-comfort-setting Heat/Cool Temp entities — `EcobeeComfortTemp`, one entity
// per preset per field), read via `hass.states` and written via the plain
// `number.set_value` service — unlike Schedule (ADR-0014), `number` entities
// register a normal `set_value` service, so no websocket write is needed here.
//
// `SetpointEdit`/`snapClamp` are reused as-is from temperature-adjust.ts: a
// single Comfort Setpoint field is exactly a `SetpointEdit` (a clamped, stepped
// value with bounds), just sourced from a `number` entity's own `min`/`max`/`step`
// attributes instead of a climate entity's `min_temp`/`max_temp` and a
// unit-derived step. There is deliberately no cross-field "push the other
// setpoint" logic here (temperature-adjust.ts's `withValue`) — Heat and Cool are
// independent `number` entities, and ha-ecobee's own `EcobeeComfortTemp.set_native_value`
// already enforces the heat/cool minimum gap server-side when a value is set, so
// duplicating that clamp here would just be redundant, second-guessing logic.

/** A single Heat or Cool field value, sourced from its own `number` entity. */
export interface ComfortSetpointValue {
  entityId: string;
  /** The unit this entity reports its value in (its own `unit_of_measurement`,
   *  not necessarily Home Assistant's configured display unit — ADR-0001: shown
   *  as the entity actually reports it, not silently converted). */
  unit: string;
  edit: SetpointEdit;
}

/** One Comfort Setting row: its display identity (shared with the Comfort
 *  Setting picker's own icon/label resolution) plus whichever of Heat/Cool
 *  actually resolved to a usable `number` entity right now. Either may be
 *  `null` — an unconfigured field, or a configured one that's currently
 *  unavailable/non-numeric (ADR-0001 graceful degradation). */
export interface ComfortSetpointPreset {
  preset: string;
  label: string;
  icon: ComfortIcon;
  heat: ComfortSetpointValue | null;
  cool: ComfortSetpointValue | null;
}

export interface ComfortSetpointsModel {
  /** False when no configured row currently resolves any usable field — the
   *  Main Menu section is hidden entirely rather than showing an empty list. */
  available: boolean;
  presets: ComfortSetpointPreset[];
}

/** A `number` entity's default step when it doesn't expose one (defensive only —
 *  every real `number` entity reports `step`; see NumberEntityCapabilityAttribute
 *  in HA core). Matches ecobee's own comfort-temp step (half a degree). */
const DEFAULT_STEP = 0.5;

function readField(
  hass: HomeAssistant,
  entityId: string | undefined,
  setpoint: Setpoint,
): ComfortSetpointValue | null {
  if (!entityId) return null;
  const entity = hass.states[entityId];
  if (!entity || UNAVAILABLE.has(entity.state)) return null;
  const value = num(entity.state);
  if (value === null) return null;
  const min = num(entity.attributes.min);
  const max = num(entity.attributes.max);
  const step = num(entity.attributes.step) ?? DEFAULT_STEP;
  const unit =
    typeof entity.attributes.unit_of_measurement === 'string'
      ? entity.attributes.unit_of_measurement
      : '';
  return { entityId, unit, edit: { setpoint, value: snapClamp(value, min, max, step), min, max, step } };
}

export function toComfortSetpointsModel(
  hass: HomeAssistant,
  config: EcoseeCardConfig,
): ComfortSetpointsModel {
  const rows = config.comfort_setpoints;
  if (!rows || rows.length === 0) return { available: false, presets: [] };

  const presets: ComfortSetpointPreset[] = [];
  for (const row of rows) {
    const heat = readField(hass, row.heat_entity, 'heat');
    const cool = readField(hass, row.cool_entity, 'cool');
    if (!heat && !cool) continue;
    presets.push({
      preset: row.preset,
      label: comfortLabelFor(row.preset),
      icon: comfortIconFor(row.preset, config),
      heat,
      cool,
    });
  }
  return { available: presets.length > 0, presets };
}

/** Format a field's value for display. Deliberately NOT `formatTemp`
 *  (home-view.ts) — that rounds to the *display unit's* convention (whole °F /
 *  half °C), which assumes the live hold's fixed `STEP_F = 1` /
 *  `STEP_C = 0.5` (temperature-adjust.ts's own doc comment: a sub-degree °F
 *  step would show each whole degree twice). A `number` entity's own `step`
 *  is independent of that — ecobee's comfort-temp entities step by half a
 *  degree even in °F — so adjacent scrubber values would collide onto the
 *  same rounded label (e.g. 68.5 and 69 both showing "69"). Showing the
 *  already step-snapped value at its own precision (no decimal for a whole
 *  step, one decimal otherwise) avoids that regardless of the display unit. */
export function formatSetpointValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Build the `number.set_value` call that writes an edited field. */
export function setNumberValueCall(entityId: string, value: number): ServiceCall {
  return { domain: 'number', service: 'set_value', data: { entity_id: entityId, value } };
}

/** Step a field's value up (+1) or down (−1) by one `step`, clamped to its
 *  entity's own bounds. */
export function nudgeSetpoint(edit: SetpointEdit, direction: 1 | -1): SetpointEdit {
  return { ...edit, value: snapClamp(edit.value + direction * edit.step, edit.min, edit.max, edit.step) };
}

/** Map a vertical drag to a scrubbed value, mirroring `temperature-adjust.ts`'s
 *  `scrub` but for a single independent field (no paired setpoint to push). */
export function scrubSetpoint(
  edit: SetpointEdit,
  startValue: number,
  deltaY: number,
  pxPerStep: number,
): SetpointEdit {
  const steps = pxPerStep > 0 ? Math.round(deltaY / pxPerStep) : 0;
  return { ...edit, value: snapClamp(startValue + steps * edit.step, edit.min, edit.max, edit.step) };
}
