export const CARD_TYPE = 'ecosee-card';

/** One curated entry in the Sensors sub-screen's list (issue #9): a temperature
 *  entity, optionally with a label override and an occupancy entity. The
 *  occupancy entity is what backs the "Occupied" badge — without it the badge is
 *  hidden (ADR-0001 graceful degradation). The thermostat's own temperature is
 *  auto-included by the seam, so it is not listed here. */
export interface SensorConfig {
  /** A temperature entity (typically a `sensor.*`, but any entity carrying a
   *  numeric temperature in its state or `current_temperature` works). */
  entity: string;
  /** Optional label override; defaults to the entity's friendly name. */
  name?: string;
  /** A binary occupancy entity (e.g. `binary_sensor.*`) that backs the "Occupied"
   *  badge for this sensor. Optional: when omitted, the Card auto-pairs the occupancy
   *  binary_sensor that shares this temperature sensor's device (the ecobee
   *  remote-sensor case — ADR-0010), so ecobee sensors get the badge with no extra
   *  config. Set this only to override that (e.g. a different binary source). If
   *  nothing resolves either way, the badge is simply not shown. */
  occupancy_entity?: string;
}

/** The card's outer corner treatment. `squircle` (the default) is the ecobee
 *  Premium's superellipse motif; `rounded` is a smaller, conventional
 *  border-radius; `square` is sharp/unrounded corners. Purely cosmetic — it
 *  swaps the shared silhouette every screen draws (styles/shape.ts), so it
 *  applies uniformly to the Home Screen, every Overlay, and the Standby Screen. */
export type CardShape = 'squircle' | 'rounded' | 'square';

/** When to show the Home Screen's top-row fan shortcut glyph (issues #45, #73).
 *  `auto` (the default) shows it only when the entity exposes a real *speed*
 *  control beyond On/Auto; `always` shows it whenever the Fan sub-screen is
 *  reachable (an On/Auto-only fan then opens straight to the On/Auto toggle);
 *  `never` hides it. Either way the Fan sub-screen stays reachable via Main Menu →
 *  Fan — this only governs the corner shortcut. */
export type ShowFan = 'auto' | 'always' | 'never';

/** Per-element visibility for the Standby Screen (the dimmed idle display). Each
 *  key defaults to shown; set one to `false` to hide that element. Deliberately
 *  YAML-only — not surfaced in the GUI editor — a knob for tinkerers. Ignored
 *  unless `standby_screen` is on. */
export interface StandbyConfig {
  /** The weather condition glyph beside the outdoor temperature. */
  weather?: boolean;
  /** The outdoor temperature (hiding it removes the whole top row, glyph included). */
  outdoor_temp?: boolean;
  /** The large current temperature. */
  current_temp?: boolean;
  /** The equipment-status edge glow — the outer glowing ring. */
  glow?: boolean;
}

/** YAML-first config (ADR-0002): this schema is the source of truth and
 *  `setConfig` validates it. The GUI editor (issue #14, `src/editor/`) is a thin
 *  form *over* this schema, not a second source — it tracks the keys here. Only
 *  `entity` is required; everything else opts additional Home-Screen affordances in. */
export interface EcoseeCardConfig {
  type: string;
  /** The primary `climate` entity the Card is bound to. Required. */
  entity: string;
  /** Optional label override; defaults to the entity's friendly name. */
  name?: string;
  /** A `weather` entity that enables the weather icon + (later) overlay. */
  weather_entity?: string;
  /** Override the current-temperature source: when set, its numeric state (or, for
   *  a `climate`/remote entity, its `current_temperature` attribute) replaces the
   *  bound entity's own `current_temperature` everywhere the Card shows it (the
   *  Home Screen number, the Standby Screen, and the Sensors screen's thermostat
   *  card). Unset ⇒ the bound entity's own reading, as before. */
  temperature_entity?: string;
  /** Override humidity source: when set, its numeric state replaces the bound
   *  entity's own `current_humidity` outright (not merely a fallback for a
   *  thermostat that reports none). Unset ⇒ the bound entity's own reading. */
  humidity_entity?: string;
  /** Glyph for custom Comfort Settings (presets without a built-in mapping). One of
   *  the Skin's icon names — `home` / `away` / `sleep` / `comfort`; anything else
   *  falls back to `comfort`. The named ecobee Comfort Settings keep their own icon. */
  default_comfort_icon?: string;
  /** A `number` entity backing the Fan minimum-runtime selector (ecobee's
   *  `fan_min_on_time`). The selector is hidden when this is unset/unavailable. */
  fan_min_on_time_entity?: string;
  /** An entity carrying a US-EPA air-quality index — its numeric state, or an
   *  `air_quality_index` attribute. Surfaces the optional air-quality element on the
   *  Home Screen; the element is hidden when this is unset/unavailable (issue #10). */
  air_quality_entity?: string;
  /** An entity carrying a UV index — its numeric state, or a `uv_index` attribute.
   *  Surfaces the optional UV-index gauge on the Home Screen; the gauge is hidden
   *  when this is unset/unavailable (ADR-0001 graceful degradation). */
  uv_index_entity?: string;
  /** Curated temperature sensors for the Sensors sub-screen (issue #9). Each item
   *  may be a bare entity-id string (shorthand) or a `SensorConfig` object. The
   *  thermostat's own temperature is auto-included first, so this lists *extra*
   *  sensors only; absent/empty hides the Sensors sub-screen entirely. */
  sensors?: SensorConfig[];
  /** Seconds of inactivity before any open Overlay auto-reverts to the Home Screen,
   *  mirroring the device's auto-return (issue #13). `0` disables auto-revert; an
   *  unset key uses the device-default (25s). See `inactivityTimeoutMs`. */
  inactivity_timeout?: number;
  /** Opt-in Standby Screen (issue #64). Off by default: absent/`false` means the Card
   *  behaves exactly as today (no standby). The switching behavior that reads this
   *  flag is a separate issue (#65) — this key is only the on/off setting. */
  standby_screen?: boolean;
  /** Per-element visibility for the Standby Screen (YAML-only — a tinkerer knob, not
   *  surfaced in the GUI editor). Each element defaults to shown; see StandbyConfig. */
  standby?: StandbyConfig;
  /** When to show the Home Screen's fan shortcut glyph (`auto` / `always` / `never`).
   *  Absent ⇒ `auto` — the glyph appears only for a fan with real speed controls
   *  (the default before this key existed). See ShowFan. */
  show_fan?: ShowFan;
  /** Minimum separation (deadband) between the heat and cool setpoints in Heat /
   *  Cool (Auto), in the display unit. Most ACs enforce a minimum gap server-side
   *  (commonly 3°F ≈ 1.5°C); pushing the setpoints closer than that gets rejected
   *  and the entity reverts — which looks like "the temperature won't change". The
   *  scrubber keeps this gap by *pushing* the paired setpoint instead of stalling.
   *  Absent ⇒ the unit default (3°F / 1.5°C). `0` lets the two setpoints meet. */
  min_gap?: number;
  /** A `sensor` entity carrying the minimum heat/cool gap as its numeric state, in
   *  the display unit (e.g. a `heatCoolMinDelta`-backed sensor from an ecobee
   *  integration that exposes the thermostat's own configured delta). When set and
   *  the entity currently has a valid numeric reading, its value is used instead
   *  of `min_gap` — kept in sync with the thermostat's own setting automatically
   *  rather than needing to be typed in and kept up to date by hand. `min_gap`
   *  (or the unit default) is the fallback whenever this is unset, or set but the
   *  entity is unavailable — unlike `temperature_entity`/`humidity_entity`, an
   *  unavailable reading here falls back rather than zeroing out the gap. */
  min_gap_entity?: string;
  /** Opt-in Resume Schedule control (ADR-0012): a pill beneath the setpoint ovals
   *  that calls `ecobee.resume_program`, mirroring the ecobee device's own
   *  manual-override → Resume Schedule affordance. Absent ⇒ `false` — no control,
   *  matching ADR-0004's default. Only meaningful for a bound entity actually driven
   *  by Home Assistant's `ecobee` integration; the Card cannot verify this and takes
   *  the key itself as the user's assertion that it's true. */
  resume_program?: boolean;
  /** The card's outer corner treatment (`squircle` / `rounded` / `square`). Absent
   *  ⇒ `squircle` — the ecobee Premium's superellipse motif, unchanged from before
   *  this key existed. Purely cosmetic; see CardShape. */
  corner_style?: CardShape;
  /** Whether the equipment-status edge glow (the colored border tracing the card's
   *  outline while heating/cooling) is shown. Absent ⇒ `true`, unchanged from
   *  before this key existed. Set `false` to hide it on every screen. */
  equipment_glow?: boolean;
  /** Whether the Home Screen's System Mode indicator glyph tints by equipment
   *  status, mirroring the ecobee device: Cool mode turns blue while cooling, Heat
   *  mode turns amber while heating, and Heat / Cool (Auto) tints its two halves
   *  independently (blue left / amber right) by which side is active. Absent ⇒
   *  `false` — the indicator stays the top-row white it always has, unaffected by
   *  equipment status. */
  mode_color?: boolean;
  /** Overrides the card's outer canvas background (any CSS color — hex, rgb(),
   *  hsl(), a named color, or `transparent` for no background). Absent ⇒ the
   *  Skin's near-black canvas (`--ecosee-bg`'s own default), unchanged from before
   *  this key existed. Purely the canvas fill — text/glyph colors and the "ink" on
   *  a selected accent-filled chip (Comfort Setting, System Mode, Fan) are separate
   *  tokens and stay legible regardless of this value. */
  background_color?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validate raw YAML into an EcoseeCardConfig, throwing user-facing errors that
 *  Home Assistant surfaces in the card's error state. */
export function parseConfig(raw: unknown): EcoseeCardConfig {
  if (!isRecord(raw)) {
    throw new Error('ecosee: invalid configuration.');
  }
  const entity = raw.entity;
  if (typeof entity !== 'string' || entity.length === 0) {
    throw new Error('ecosee: `entity` is required (a `climate.*` entity).');
  }
  if (!entity.startsWith('climate.')) {
    throw new Error(`ecosee: \`entity\` must be a climate entity, got "${entity}".`);
  }
  const optionalString = (
    key:
      | 'name'
      | 'weather_entity'
      | 'temperature_entity'
      | 'humidity_entity'
      | 'default_comfort_icon'
      | 'fan_min_on_time_entity'
      | 'air_quality_entity'
      | 'uv_index_entity'
      | 'min_gap_entity',
  ): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      throw new Error(`ecosee: \`${key}\` must be a string entity id.`);
    }
    return value;
  };

  return {
    type: typeof raw.type === 'string' ? raw.type : `custom:${CARD_TYPE}`,
    entity,
    name: optionalString('name'),
    weather_entity: optionalString('weather_entity'),
    temperature_entity: optionalString('temperature_entity'),
    humidity_entity: optionalString('humidity_entity'),
    default_comfort_icon: optionalString('default_comfort_icon'),
    fan_min_on_time_entity: optionalString('fan_min_on_time_entity'),
    air_quality_entity: optionalString('air_quality_entity'),
    uv_index_entity: optionalString('uv_index_entity'),
    sensors: parseSensors(raw.sensors),
    inactivity_timeout: parseInactivityTimeout(raw.inactivity_timeout),
    standby_screen: parseStandbyScreen(raw.standby_screen),
    standby: parseStandby(raw.standby),
    show_fan: parseShowFan(raw.show_fan),
    min_gap: parseMinGap(raw.min_gap),
    min_gap_entity: optionalString('min_gap_entity'),
    resume_program: parseResumeProgram(raw.resume_program),
    corner_style: parseCornerStyle(raw.corner_style),
    equipment_glow: parseEquipmentGlow(raw.equipment_glow),
    mode_color: parseModeColor(raw.mode_color),
    background_color: parseBackgroundColor(raw.background_color),
  };
}

/** The legal `corner_style` values; `squircle` (the default) is first. */
const CARD_SHAPE_VALUES: readonly CardShape[] = ['squircle', 'rounded', 'square'];

/** Parse the optional `corner_style` control. Returns `undefined` when absent so
 *  the seam applies the `squircle` default (unchanged from before this key
 *  existed). Throws a user-facing error for anything outside the small enum. */
function parseCornerStyle(raw: unknown): CardShape | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !CARD_SHAPE_VALUES.includes(raw as CardShape)) {
    throw new Error("ecosee: `corner_style` must be one of 'squircle', 'rounded', 'square'.");
  }
  return raw as CardShape;
}

/** Parse the optional `equipment_glow` toggle. Returns `undefined` when absent so
 *  the seam applies the `true` default (unchanged from before this key existed).
 *  Throws a user-facing error for any non-boolean value. */
function parseEquipmentGlow(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error('ecosee: `equipment_glow` must be a boolean.');
  }
  return raw;
}

/** Parse the optional `mode_color` toggle. Returns `undefined` when absent so the
 *  seam applies the `false` default (the System Mode indicator stays plain white,
 *  unchanged from before this key existed). Throws a user-facing error for any
 *  non-boolean value. */
function parseModeColor(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error('ecosee: `mode_color` must be a boolean.');
  }
  return raw;
}

/** Parse the optional `background_color` override. Returns `undefined` when
 *  absent so the seam applies the Skin's own near-black canvas default, unchanged
 *  from before this key existed. Takes any non-empty string verbatim — validating
 *  CSS color syntax is the browser's job (an invalid value just fails to paint,
 *  same as a typo in any other CSS color a dashboard might supply); this only
 *  rejects the non-string/empty cases that are clearly not a color at all. */
function parseBackgroundColor(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('ecosee: `background_color` must be a non-empty CSS color string.');
  }
  return raw;
}

/** Parse the optional `min_gap` (minimum heat/cool separation, in the display
 *  unit). Returns `undefined` when absent so the seam applies the unit default
 *  (3°F / 1.5°C); `0` is a legal "let them meet". Throws a user-facing error for
 *  anything other than a non-negative number. */
function parseMinGap(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0) {
    throw new Error('ecosee: `min_gap` must be a non-negative number of degrees.');
  }
  return raw;
}

/** Parse the optional `resume_program` toggle (ADR-0012). Returns `undefined` when
 *  absent so the seam applies the `false` default (no Resume Schedule control,
 *  matching ADR-0004). Throws a user-facing error for any non-boolean value. */
function parseResumeProgram(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error('ecosee: `resume_program` must be a boolean.');
  }
  return raw;
}

/** The legal `show_fan` values; `auto` (the default) is first. */
const SHOW_FAN_VALUES: readonly ShowFan[] = ['auto', 'always', 'never'];

/** Parse the optional `show_fan` control. Returns `undefined` when absent so the
 *  seam applies the `auto` default (glyph only for a real speed control). Throws a
 *  user-facing error for anything outside the small enum. */
function parseShowFan(raw: unknown): ShowFan | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !SHOW_FAN_VALUES.includes(raw as ShowFan)) {
    throw new Error("ecosee: `show_fan` must be one of 'auto', 'always', 'never'.");
  }
  return raw as ShowFan;
}

/** Parse the optional `standby` per-element visibility object. Returns `undefined`
 *  when absent (every element shown). Each present key must be a boolean; unset keys
 *  stay `undefined` so the seam treats them as shown. Throws a user-facing error for
 *  a non-object value or a non-boolean toggle. */
function parseStandby(raw: unknown): StandbyConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    throw new Error('ecosee: `standby` must be an object of on/off toggles.');
  }
  const bool = (key: keyof StandbyConfig): boolean | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
      throw new Error(`ecosee: \`standby.${key}\` must be a boolean.`);
    }
    return value;
  };
  return {
    weather: bool('weather'),
    outdoor_temp: bool('outdoor_temp'),
    current_temp: bool('current_temp'),
    glow: bool('glow'),
  };
}

/** Parse the optional `standby_screen` toggle (issue #64). Returns `undefined` when
 *  absent so the feature stays off by default (graceful degradation); a boolean is
 *  taken verbatim. Throws a user-facing error for any non-boolean value. */
function parseStandbyScreen(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error('ecosee: `standby_screen` must be a boolean.');
  }
  return raw;
}

/** Parse the optional `inactivity_timeout` (seconds before an open Overlay
 *  auto-reverts to the Home Screen). Returns `undefined` when absent so the seam
 *  can apply the device-default; `0` is the canonical "off". Throws a user-facing
 *  error for anything other than a non-negative number. */
function parseInactivityTimeout(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw < 0) {
    throw new Error('ecosee: `inactivity_timeout` must be a non-negative number of seconds.');
  }
  return raw;
}

/** Parse the optional `sensors:` list. Each item is either a bare entity-id
 *  string (shorthand) or a `{ entity, name?, occupancy_entity? }` object. Returns
 *  `undefined` when the key is absent so the rest of the Card can treat "no
 *  sensors configured" uniformly. Throws user-facing errors for malformed input. */
function parseSensors(raw: unknown): SensorConfig[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error('ecosee: `sensors` must be a list of sensor entities.');
  }
  return raw.map((item, index) => parseSensor(item, index));
}

function parseSensor(item: unknown, index: number): SensorConfig {
  if (typeof item === 'string') {
    if (item.length === 0) {
      throw new Error(`ecosee: \`sensors[${index}]\` must be a non-empty entity id.`);
    }
    return { entity: item };
  }
  if (!isRecord(item)) {
    throw new Error(`ecosee: \`sensors[${index}]\` must be an entity id or an object.`);
  }
  const entity = item.entity;
  if (typeof entity !== 'string' || entity.length === 0) {
    throw new Error(`ecosee: \`sensors[${index}].entity\` is required (a sensor entity id).`);
  }
  const optional = (key: 'name' | 'occupancy_entity'): string | undefined => {
    const value = item[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      throw new Error(`ecosee: \`sensors[${index}].${key}\` must be a string entity id.`);
    }
    return value;
  };
  return { entity, name: optional('name'), occupancy_entity: optional('occupancy_entity') };
}
