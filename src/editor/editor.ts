import { CARD_TYPE } from '../config';

// The derivation seam for the GUI config editor (issue #14) — the editor's
// counterpart to the overlay seams (`toHomeView`, `toWeatherModel`). It owns the
// schema↔config reconciliation so the Lit element stays a thin shell over Home
// Assistant's `<ha-form>`:
//
//   • `editorSchema()` describes every config key as an `ha-form` field, with a
//     domain-scoped entity picker where the value is an entity id (ADR-0002 —
//     Lit + the HA frontend give us first-class config-editor support, so we lean
//     on `ha-form`'s selectors rather than reimplementing entity pickers).
//   • `toEditorData()` adapts a stored config into the value `ha-form` renders
//     (spreading object-form `sensors` across the per-sensor picker/name fields).
//   • `normalizeEditorConfig()` turns a form value back into a config the Card's
//     `parseConfig` accepts: an unset optional key is *dropped*, not emitted as an
//     empty string (the optional-config-key pattern — absent means "feature off",
//     ADR-0001 graceful degradation), while object-form sensor overrides and any
//     key the GUI does not yet surface survive an unrelated edit.
//
// Keeping all of this pure makes it unit-testable without rendering a Lit element
// (the editor element itself is presentational and untested, like the overlays).

/** One clause of an entity selector's `filter` (OR-combined when several are given).
 *  Lets the sensors picker scope to temperature sensors while still allowing a
 *  `climate` entity as a temperature source. */
export interface EntityFilter {
  domain?: string | string[];
  device_class?: string | string[];
}

/** An `ha-form` selector descriptor — the subset of HA's selectors this editor
 *  uses. A bare entity id → a domain- (and optionally device-class-) scoped `entity`
 *  picker; each sensor row → an entity picker filtered to temperature sensors (plus
 *  climate); a free string → `text`; the idle timeout → `number`; an opt-in toggle →
 *  `boolean`; a small fixed enum → `select` (the first option is its default). */
export type EditorSelector =
  | {
      entity: {
        domain?: string | string[];
        device_class?: string | string[];
        multiple?: boolean;
        filter?: EntityFilter[];
      };
    }
  | { text: Record<string, never> }
  | { number: { min?: number; mode?: 'box'; unit_of_measurement?: string } }
  // `default` is the value `normalizeEditorConfig` treats as "unset" (dropped from
  // the stored config); absent ⇒ `false`, matching every toggle before
  // `equipment_glow` (opt-in features that default off). `equipment_glow` is the
  // first toggle that defaults *on*, so it sets `default: true` to keep the
  // optional-config-key hygiene (unset ⇒ shown) while still letting an explicit
  // uncheck persist as `equipment_glow: false`.
  | { boolean: { default?: boolean } }
  | { select: { options: Array<{ value: string; label: string }>; mode?: 'dropdown' | 'list' } };

/** One `ha-form` field. `name`/`selector`/`required` are what `ha-form` consumes;
 *  `label`/`helper` ride along for the element's `computeLabel`/`computeHelper`
 *  callbacks (`ha-form` hands the schema entry back to them and ignores the rest). */
export interface EditorField {
  /** The config key this control edits. */
  name: string;
  /** Device-vocabulary label (CONTEXT.md) shown above the control. */
  label: string;
  /** Optional helper line beneath the control. */
  helper?: string;
  /** Only the primary `entity` is required. */
  required?: boolean;
  selector: EditorSelector;
}

/** The entity filter shared by every sensor picker: temperature `sensor.*`
 *  entities plus any `climate` entity (which carries its own current
 *  temperature). One filter clause per allowed source (OR-combined). */
const SENSOR_ENTITY_FILTER: EntityFilter[] = [
  { domain: 'sensor', device_class: 'temperature' },
  { domain: 'climate' },
];

/** Helper copy for the Sensors block — on the base `sensors` anchor field and,
 *  in the rendered schema, on the trailing "add a sensor" picker. */
const SENSORS_HELPER =
  'Optional. Extra temperature entities for the Sensors sub-screen, hidden until you add one. ' +
  'A display-name field and an optional occupancy-entity override sit beneath each sensor.';

/** The form, in display order, tracking the config schema (issue #14). Most keys in
 *  `EcoseeCardConfig` (bar `type`, which HA owns) have exactly one field here,
 *  mirroring `parseConfig`; a new config key must be added alongside its overlay. One
 *  key `parseConfig` still accepts for backward compatibility is intentionally not
 *  surfaced (the comfort-icon override, removed in #58) — an existing config that
 *  sets it keeps loading and its value survives a GUI edit untouched. */
export function editorSchema(): EditorField[] {
  return [
    {
      name: 'entity',
      label: 'Thermostat',
      helper: 'Required. The climate entity this Card is bound to.',
      required: true,
      selector: { entity: { domain: 'climate' } },
    },
    {
      name: 'name',
      label: 'Name',
      helper: "Optional. Overrides the thermostat's friendly name.",
      selector: { text: {} },
    },
    {
      name: 'weather_entity',
      label: 'Weather entity',
      helper:
        'Optional. Adds the weather icon and Weather sub-screen; hidden until an entity is set.',
      selector: { entity: { domain: 'weather' } },
    },
    {
      name: 'temperature_entity',
      label: 'Temperature entity',
      helper:
        "Optional. Overrides the thermostat's own current-temperature reading with this entity's value.",
      selector: { entity: { filter: SENSOR_ENTITY_FILTER } },
    },
    {
      name: 'humidity_entity',
      label: 'Humidity entity',
      helper: "Optional. Overrides the thermostat's own humidity reading with this entity's value.",
      selector: { entity: { domain: 'sensor', device_class: 'humidity' } },
    },
    {
      name: 'air_quality_entity',
      label: 'Air quality entity',
      helper:
        'Optional. Adds the air-quality element (a US-EPA air-quality index); hidden until an entity is set.',
      selector: { entity: { domain: 'sensor', device_class: 'aqi' } },
    },
    {
      name: 'uv_index_entity',
      label: 'UV index entity',
      helper: 'Optional. Adds the UV-index gauge; hidden until an entity is set.',
      selector: { entity: { domain: 'sensor' } },
    },
    {
      // Anchor for the Sensors block. `composeEditorSchema` replaces this single
      // field with one entity picker per sensor (each followed by its display-name
      // field) plus a trailing empty picker to add another; the base field only
      // fixes the block's position and tracks the `sensors` config key.
      name: 'sensors',
      label: 'Sensors',
      helper: SENSORS_HELPER,
      selector: { entity: { filter: SENSOR_ENTITY_FILTER } },
    },
    {
      name: 'show_fan',
      label: 'Fan shortcut',
      helper:
        'Optional. When to show the Home Screen fan shortcut. Auto shows it only for fans with ' +
        'real speeds; Always shows it for any fan (On/Auto included); Never hides it. Default Auto.',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'auto', label: 'Auto (speeds only)' },
            { value: 'always', label: 'Always' },
            { value: 'never', label: 'Never' },
          ],
        },
      },
    },
    {
      name: 'fan_min_on_time_entity',
      label: 'Fan minimum runtime entity',
      helper:
        "Optional. A number entity (ecobee's fan_min_on_time). Adds a minimum-runtime selector to " +
        'the Fan sub-screen; hidden until an entity is set.',
      selector: { entity: { domain: 'number' } },
    },
    {
      name: 'inactivity_timeout',
      label: 'Inactivity timeout',
      helper:
        'Optional. Seconds an open overlay waits before reverting to the Home Screen. 0 disables; unset uses 25s.',
      selector: { number: { min: 0, mode: 'box', unit_of_measurement: 'seconds' } },
    },
    {
      name: 'min_gap',
      label: 'Heat / Cool minimum gap',
      helper:
        'Optional. Minimum separation kept between the heat and cool setpoints in Heat / Cool ' +
        '(Auto), in your temperature unit. 0 lets them meet. Unset uses the default (3°F / 1.5°C). ' +
        'Ignored while the minimum gap entity below has a reading.',
      selector: { number: { min: 0, mode: 'box' } },
    },
    {
      name: 'min_gap_entity',
      label: 'Minimum gap entity',
      helper:
        'Optional. A sensor entity carrying the minimum heat/cool gap (e.g. an ecobee integration' +
        "'s heat/cool delta sensor). Used instead of the fixed gap above whenever it has a reading; " +
        'falls back to the gap above if unset or unavailable.',
      selector: { entity: { domain: 'sensor' } },
    },
    {
      name: 'resume_program',
      label: 'Resume Schedule control',
      helper:
        'Optional. Adds a Resume Schedule control beneath the setpoints, calling ' +
        "ecobee.resume_program — only works for a thermostat bound through Home Assistant's " +
        'ecobee integration. Off by default.',
      selector: { boolean: {} },
    },
    {
      name: 'corner_style',
      label: 'Corner style',
      helper:
        "Optional. The card's outer corner treatment. Squircle is the ecobee Premium's full-bubble " +
        'motif; Rounded is a smaller, conventional radius; Square is sharp corners. Default Squircle.',
      selector: {
        select: {
          mode: 'dropdown',
          options: [
            { value: 'squircle', label: 'Squircle (full bubble)' },
            { value: 'rounded', label: 'Rounded (small radius)' },
            { value: 'square', label: 'Square (sharp corners)' },
          ],
        },
      },
    },
    {
      name: 'equipment_glow',
      label: 'Equipment status glow',
      helper:
        'Optional. Shows the colored edge glow while heating/cooling (blue cooling / amber heating). ' +
        'On by default; uncheck to hide it on every screen.',
      selector: { boolean: { default: true } },
    },
    {
      name: 'mode_color',
      label: 'System Mode icon color',
      helper:
        'Optional. Tints the Home Screen System Mode icon by equipment status, like the ecobee ' +
        'device: blue while cooling, amber while heating (split left/right in Heat / Cool Auto). ' +
        'Off by default.',
      selector: { boolean: {} },
    },
    {
      name: 'background_color',
      label: 'Background color',
      helper:
        'Optional. Overrides the card\'s background (any CSS color, e.g. #1a1a2e, or "transparent" ' +
        'for no background). Chip/picker text stays legible regardless. Default near-black.',
      selector: { text: {} },
    },
    {
      name: 'standby_screen',
      label: 'Standby Screen',
      helper: 'Optional. Enables the Standby Screen. Off by default.',
      selector: { boolean: {} },
    },
  ];
}

/** Prefix for the synthetic per-sensor display-name fields. Not a config key — it
 *  only lives in the form value; `normalizeEditorConfig` folds these back into
 *  `sensors[].name` and never writes the prefixed key into the stored config. */
export const SENSOR_NAME_PREFIX = 'sensor_name::';

/** The form-data key carrying a sensor's display name (prefix + its entity id). */
export function sensorNameKey(entityId: string): string {
  return `${SENSOR_NAME_PREFIX}${entityId}`;
}

/** Prefix for the synthetic per-sensor occupancy-entity pickers, mirroring
 *  SENSOR_NAME_PREFIX. Not a config key — `normalizeEditorConfig` folds these back
 *  into `sensors[].occupancy_entity` and never writes the prefixed key into the
 *  stored config. */
export const SENSOR_OCCUPANCY_PREFIX = 'sensor_occupancy::';

/** The form-data key carrying a sensor's occupancy-entity override (prefix + its
 *  temperature entity id). */
export function sensorOccupancyKey(entityId: string): string {
  return `${SENSOR_OCCUPANCY_PREFIX}${entityId}`;
}

/** The entity filter for a sensor's occupancy-entity picker: a binary occupancy
 *  sensor. */
const OCCUPANCY_ENTITY_FILTER: EntityFilter[] = [
  { domain: 'binary_sensor', device_class: 'occupancy' },
];

/** Prefix for the synthetic per-sensor entity pickers. Like SENSOR_NAME_PREFIX,
 *  these keys live only in the form value — one indexed picker per configured
 *  sensor plus a trailing empty one to add another. `normalizeEditorConfig` reads
 *  them back into the `sensors` array; they are never written to stored config.
 *  Keyed by position (not entity id) so a picker keeps its identity while the user
 *  swaps the entity in it. */
export const SENSOR_ENTITY_PREFIX = 'sensor_entity::';

/** The form-data key for the Nth sensor's entity picker (prefix + index). */
export function sensorEntityKey(index: number): string {
  return `${SENSOR_ENTITY_PREFIX}${index}`;
}

/** The Sensors editing block: for each configured sensor, its entity picker with
 *  the sensor's own display-name field directly beneath it, then a trailing empty
 *  picker that adds another sensor. This is what replaces the old single
 *  multi-entity picker, so each display name sits with the sensor it names rather
 *  than in one block at the bottom (they let a user label each curated sensor from
 *  the GUI — names were previously only settable in YAML). Always returns at least
 *  the trailing "add" picker so the first sensor can be added. */
export function sensorFields(config: Record<string, unknown>): EditorField[] {
  const ids = sensorEntityIds(config.sensors);
  const fields: EditorField[] = [];
  ids.forEach((entity, index) => {
    fields.push(sensorEntityField(index, false));
    fields.push({
      name: sensorNameKey(entity),
      label: `Sensor name — ${entity}`,
      helper: "Optional. Shown in the Sensors sub-screen; defaults to the sensor's own name.",
      selector: { text: {} },
    });
    fields.push({
      name: sensorOccupancyKey(entity),
      label: `Occupancy entity — ${entity}`,
      helper:
        'Optional. Overrides the "Occupied" badge source for this sensor. Unset auto-pairs an ' +
        "occupancy binary_sensor sharing the sensor's device (e.g. ecobee remote sensors).",
      selector: { entity: { filter: OCCUPANCY_ENTITY_FILTER } },
    });
  });
  // Trailing empty picker: choosing an entity here appends a new sensor row.
  fields.push(sensorEntityField(ids.length, true));
  return fields;
}

/** One sensor entity picker. Existing rows carry a bare "Sensor" label; the
 *  trailing add slot gets an inviting label and the Sensors helper. */
function sensorEntityField(index: number, isAdd: boolean): EditorField {
  return {
    name: sensorEntityKey(index),
    label: isAdd ? 'Add a sensor' : 'Sensor',
    helper: isAdd ? SENSORS_HELPER : undefined,
    selector: { entity: { filter: SENSOR_ENTITY_FILTER } },
  };
}

/** The full form schema for a given config: the base fields, with the single
 *  `sensors` anchor expanded into one entity picker per sensor (each followed by
 *  its display-name field) plus a trailing "add" picker. The editor element
 *  recomputes this each render so the rows track the currently-selected sensors.
 *  `editorSchema()` itself stays the pure base (one field per config key). */
export function composeEditorSchema(config: Record<string, unknown>): EditorField[] {
  const composed: EditorField[] = [];
  for (const field of editorSchema()) {
    if (field.name === 'sensors') {
      composed.push(...sensorFields(config));
      continue;
    }
    composed.push(field);
  }
  return composed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A stored sensor entry, normalized from either shorthand string or object form. */
interface StoredSensor {
  entity: string;
  name?: string;
  occupancy_entity?: string;
}

/** Normalize a stored `sensors` value into `StoredSensor[]`, accepting shorthand
 *  strings and `{ entity, name?, occupancy_entity? }` objects alike. */
function readSensorObjects(value: unknown): StoredSensor[] {
  if (!Array.isArray(value)) return [];
  const out: StoredSensor[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      if (item) out.push({ entity: item });
      continue;
    }
    if (isRecord(item) && typeof item.entity === 'string') {
      const sensor: StoredSensor = { entity: item.entity };
      if (typeof item.name === 'string') sensor.name = item.name;
      if (typeof item.occupancy_entity === 'string')
        sensor.occupancy_entity = item.occupancy_entity;
      out.push(sensor);
    }
  }
  return out;
}

/** The entity ids behind a `sensors` value, accepting either shorthand strings or
 *  `{ entity }` objects (so a stored object-form list maps cleanly to the picker). */
function sensorEntityIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return item ? [item] : [];
    if (isRecord(item) && typeof item.entity === 'string') return [item.entity];
    return [];
  });
}

/** Adapt a stored config into the value `<ha-form>` renders: the `sensors` array is
 *  spread across the per-sensor form fields — each entry's entity id under its
 *  indexed picker key, and its stored display name under its per-sensor name field
 *  (so the GUI shows the name it will edit). The single `sensors` key is dropped
 *  (no field renders it). Everything else passes through unchanged. */
export function toEditorData(config: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...config };
  // Reflect the effective fan-shortcut choice in the dropdown even when the key is
  // absent (unset ⇒ Auto), so the select never renders blank.
  if (data.show_fan === undefined) data.show_fan = 'auto';
  // Same for the corner style (unset ⇒ Squircle) and the equipment glow toggle
  // (unset ⇒ on) — both selects/checkboxes must render their true effective value,
  // not a blank/unchecked one, when the key has never been set.
  if (data.corner_style === undefined) data.corner_style = 'squircle';
  if (data.equipment_glow === undefined) data.equipment_glow = true;
  if (config.sensors !== undefined) {
    delete data.sensors;
    readSensorObjects(config.sensors).forEach((sensor, index) => {
      data[sensorEntityKey(index)] = sensor.entity;
      if (sensor.name !== undefined) data[sensorNameKey(sensor.entity)] = sensor.name;
      if (sensor.occupancy_entity !== undefined) {
        data[sensorOccupancyKey(sensor.entity)] = sensor.occupancy_entity;
      }
    });
  }
  return data;
}

/** The selected sensor entity ids, read from the per-index pickers in index order.
 *  Blank pickers (a cleared row, or the trailing add slot) are skipped, and repeats
 *  de-duped so the same entity can't be added twice. */
function readSensorPickerIds(formValue: Record<string, unknown>): string[] {
  const indexed: Array<{ index: number; entity: string }> = [];
  for (const key of Object.keys(formValue)) {
    if (!key.startsWith(SENSOR_ENTITY_PREFIX)) continue;
    const raw = formValue[key];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    indexed.push({ index: Number(key.slice(SENSOR_ENTITY_PREFIX.length)), entity: raw.trim() });
  }
  indexed.sort((a, b) => a.index - b.index);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const { entity } of indexed) {
    if (seen.has(entity)) continue;
    seen.add(entity);
    ids.push(entity);
  }
  return ids;
}

/** Fold the per-sensor entity pickers plus their display-name and occupancy-entity
 *  fields back into the config. An empty set drops the key (Sensors sub-screen
 *  hidden). For each selected sensor, its name and occupancy override come from
 *  their GUI fields (blank clears either → name defaults to the friendly name,
 *  occupancy defaults to the auto-paired sensor); when a field is absent from the
 *  form value we fall back to the stored value so nothing is silently lost. A
 *  sensor with neither a name nor an occupancy override collapses to a shorthand
 *  string. */
function applySensors(
  next: Record<string, unknown>,
  prev: unknown,
  formValue: Record<string, unknown>,
): void {
  const ids = readSensorPickerIds(formValue);
  if (ids.length === 0) {
    delete next.sensors;
    return;
  }
  const prevById = new Map<string, StoredSensor>();
  for (const sensor of readSensorObjects(prev)) prevById.set(sensor.entity, sensor);

  next.sensors = ids.map((entity) => {
    const nameKey = sensorNameKey(entity);
    const typedName = nameKey in formValue ? formValue[nameKey] : prevById.get(entity)?.name;
    const name = typeof typedName === 'string' && typedName.trim() !== '' ? typedName : undefined;

    const occupancyKey = sensorOccupancyKey(entity);
    const typedOccupancy =
      occupancyKey in formValue ? formValue[occupancyKey] : prevById.get(entity)?.occupancy_entity;
    const occupancy =
      typeof typedOccupancy === 'string' && typedOccupancy.trim() !== ''
        ? typedOccupancy
        : undefined;

    if (name === undefined && occupancy === undefined) return entity; // shorthand string
    const object: StoredSensor = { entity };
    if (name !== undefined) object.name = name;
    if (occupancy !== undefined) object.occupancy_entity = occupancy;
    return object;
  });
}

/** Turn an `<ha-form>` value into a config `parseConfig` accepts. Starts from the
 *  previously-stored config so keys the editor does not surface survive (e.g.
 *  per-sensor `occupancy_entity`), then for each schema field either sets the new
 *  value or *drops* the key when it is empty — so an optional feature stays absent
 *  rather than configured-but-empty (ADR-0001). `sensors` is rebuilt from the
 *  per-sensor entity pickers plus their display-name fields (see applySensors). The required `entity`
 *  is always kept (even empty); `parseConfig` is what rejects an empty one. */
export function normalizeEditorConfig(
  value: Record<string, unknown>,
  prev: Record<string, unknown> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prev };
  next.type = typeof prev.type === 'string' ? prev.type : `custom:${CARD_TYPE}`;

  for (const field of editorSchema()) {
    if (field.name === 'sensors') {
      applySensors(next, prev.sensors, value);
      continue;
    }
    const raw = value[field.name];

    if (field.required) {
      next[field.name] = typeof raw === 'string' ? raw : '';
      continue;
    }
    if ('number' in field.selector) {
      if (typeof raw === 'number' && Number.isFinite(raw)) next[field.name] = raw;
      else delete next[field.name];
      continue;
    }
    if ('boolean' in field.selector) {
      // A toggle stays absent at its own default — `false` for every opt-in
      // feature before `equipment_glow` (only a `true` override is written back),
      // `true` for `equipment_glow` itself (on by default; only an explicit
      // uncheck — `false` — is written back). Keeps the optional-config-key
      // hygiene: unset always means "whatever the seam already defaults to".
      const def = field.selector.boolean.default ?? false;
      if (typeof raw === 'boolean' && raw !== def) next[field.name] = raw;
      else delete next[field.name];
      continue;
    }
    if ('select' in field.selector) {
      // The first option is the default (e.g. `show_fan: auto`), so a default or
      // empty choice drops the key — keeping the optional-config-key hygiene — while
      // any non-default choice is written back.
      const def = field.selector.select.options[0]?.value;
      if (typeof raw === 'string' && raw !== '' && raw !== def) next[field.name] = raw;
      else delete next[field.name];
      continue;
    }
    // String-ish: a single entity picker or free text.
    if (typeof raw === 'string' && raw !== '') next[field.name] = raw;
    else delete next[field.name];
  }

  return next;
}
