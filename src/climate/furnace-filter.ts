import type { HomeAssistant } from '../types/hass';
import type { EcoseeCardConfig } from '../config';
import { UNAVAILABLE } from './home-view';
import { num } from './parse';
import { dayStart } from '../schedule/schedule';
import type { ServiceCall } from './service-call';

// The derivation seam for the Furnace Filter Main Menu section (a Card
// addition — the physical device has no equivalent screen; owner request:
// "can we change the left icon '22' in the menu to be a menu for the furnace
// filter... last change date, the interval, and a big button to mark that the
// filter has been changed"). Generic by design (ADR-0001): the config points
// at whatever entities the user's own integration/helpers expose rather than
// assuming one specific ecobee-fork schema, since — per the owner's own
// framing — this varies from user to user.

/** Domains `markFilterChangedCall` can write "today" onto directly, confirmed
 *  against home-assistant/core's own component sources:
 *  `input_datetime.set_datetime` (`{date: "YYYY-MM-DD"}`, only the fields the
 *  helper's own has_date/has_time config actually uses),
 *  `date.set_value` (`{date: "YYYY-MM-DD"}`), `datetime.set_value`
 *  (`{datetime: <ISO 8601 with an explicit UTC offset>}`). A `sensor` (or any
 *  other domain) is read-only from here — `filter_reset_entity` is the only
 *  way to back the button for one of those. */
const WRITABLE_DATE_DOMAINS = new Set(['input_datetime', 'date', 'datetime']);

function domainOf(entityId: string): string {
  return entityId.split('.')[0] ?? '';
}

/** Lenient date parsing across every domain `filter_last_changed_entity` can
 *  point at. `input_datetime` reports either `"2025-01-15"` (date-only) or
 *  the space-separated `"2025-01-15 00:00:00"` (date+time — confirmed
 *  against `input_datetime/__init__.py`'s own `FMT_DATE`/`FMT_DATETIME`);
 *  `date` reports `"2025-01-15"`; `datetime` reports a full ISO 8601 string
 *  with an explicit UTC offset. `Date`'s constructor parses the first three
 *  natively, but not reliably the space-separated form (not part of the
 *  ECMA-262 date grammar, even though several engines accept it loosely) —
 *  coercing the space to "T" makes it strict ISO-8601. A `sensor`'s state is
 *  whatever its own integration formats, so this is a best-effort parse for
 *  that case, not a guarantee (ADR-0001: an unparseable reading degrades to
 *  the section simply not being available, not a crash or a fake date). */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseFilterDate(state: string): Date | null {
  if (!state) return null;
  // A bare "YYYY-MM-DD" (date/input_datetime's date-only form) names a wall-
  // clock calendar date, not an instant — but `new Date("YYYY-MM-DD")` parses
  // it as UTC midnight (ECMA-262), which `dayStart`'s local-midnight rollup
  // then rolls back a calendar day for anyone west of UTC. Parse the
  // components directly into a local date instead.
  const dateOnly = DATE_ONLY.exec(state);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const local = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const direct = new Date(state);
  if (!Number.isNaN(direct.getTime())) return direct;
  const coerced = new Date(state.replace(' ', 'T'));
  return Number.isNaN(coerced.getTime()) ? null : coerced;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

type IntervalUnit = 'days' | 'weeks' | 'months';

interface ResolvedInterval {
  amount: number;
  unit: IntervalUnit;
}

/** `addDays`'s counterpart for weeks/months — calendar-correct (not a fixed
 *  ~30-day approximation), so a "3 months" interval lands on the same
 *  day-of-month three months out rather than drifting by however many of the
 *  spanned months are short or long. */
function addInterval(date: Date, interval: ResolvedInterval): Date {
  if (interval.unit === 'months') {
    const next = new Date(date);
    next.setMonth(next.getMonth() + interval.amount);
    return next;
  }
  return addDays(date, interval.unit === 'weeks' ? interval.amount * 7 : interval.amount);
}

/** Whole days between two already-`dayStart`-aligned dates. `addInterval`
 *  never introduces a time-of-day component, so this is exact bar a DST
 *  crossing shifting the raw ms difference by an hour either side of a whole
 *  day — `Math.round` (not `Math.floor`) absorbs that. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Read `filter_interval_entity`'s own `unit_of_measurement` to decide how to
 *  interpret its numeric reading. Real-world interval helpers vary — a
 *  reported "Furnace Filter Reminder Interval" `number` entity may track
 *  months (`min: 1, max: 12, unit_of_measurement: "months"`), not days.
 *  Unset/unrecognized defaults to days, matching `filter_interval_days`'s own
 *  unit and every prior release's assumption. */
function intervalUnitFromEntity(entity: { attributes: Record<string, unknown> }): IntervalUnit {
  const raw = entity.attributes.unit_of_measurement;
  const unit = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (unit.startsWith('month') || unit === 'mo' || unit === 'mos' || unit === 'mo.')
    return 'months';
  if (unit.startsWith('week') || unit === 'wk' || unit === 'wks') return 'weeks';
  return 'days';
}

/** `"YYYY-MM-DD"` from local date components (not `toISOString`, which
 *  converts to UTC first — the same local-date convention Schedule's own
 *  `toLocalIso` uses, schedule.ts). Exported: the overlay's native
 *  `<input type="date">` (HTML's own date-input value format, always
 *  "YYYY-MM-DD" regardless of locale) is seeded from this. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The interval from `filter_interval_entity` (unit-aware, `intervalUnitFromEntity`)
 *  when it currently has a valid positive reading, falling back to
 *  `filter_interval_days` (always days) otherwise — `undefined`/unavailable/
 *  non-numeric/non-positive all fall through, mirroring `min_gap_entity`'s own
 *  fallback shape. `null` when neither resolves to anything. */
function resolveInterval(hass: HomeAssistant, config: EcoseeCardConfig): ResolvedInterval | null {
  const entityId = config.filter_interval_entity;
  if (entityId) {
    const entity = hass.states[entityId];
    if (entity && !UNAVAILABLE.has(entity.state)) {
      const value = num(entity.state);
      if (value !== null && value > 0)
        return { amount: value, unit: intervalUnitFromEntity(entity) };
    }
  }
  const days = config.filter_interval_days;
  return days !== undefined ? { amount: days, unit: 'days' } : null;
}

/** `"3 months"` / `"1 month"` — the entity's own resolved unit
 *  (`intervalUnitFromEntity`), pluralized. All three recognized units are
 *  regular plurals, so a bare `-s` trim covers the singular case. */
export function formatIntervalUnit(amount: number, unit: IntervalUnit): string {
  const singular = unit.slice(0, -1);
  return `${amount} ${amount === 1 ? singular : unit}`;
}

/** One selectable interval value, in the entity's own unit. */
export interface IntervalOption {
  value: number;
  label: string;
  selected: boolean;
}

/** The interval, editable from the section itself — only present when
 *  `filter_interval_entity` is actually configured and currently resolves (a
 *  plain `filter_interval_days` has no entity to write to, so there's nothing
 *  to edit in that case; the section still shows the computed due date, just
 *  without an edit affordance on it). A dropdown menu of discrete `options`
 *  (owner request: "can the interval be a menu style like the fan
 *  duration"), matching the Fan screen's own minimum-runtime selector
 *  (`fan.ts`'s `MinRuntimeModel`) rather than a free-form numeric input — the
 *  values/labels are in the entity's own unit (e.g. `{ value: 3, unit:
 *  'months' }`), not the day-converted `intervalDays` above. */
export interface FilterIntervalEdit {
  entityId: string;
  value: number;
  unit: IntervalUnit;
  options: IntervalOption[];
}

/** Fallback bounds when the entity itself doesn't report `min`/`max`/`step` —
 *  defensive only, mirroring `fan.ts`'s own `DEFAULT_MIN`/`DEFAULT_MAX`/
 *  `DEFAULT_STEP`; a real `number` entity almost always reports all three
 *  (HA's own `number` domain defaults them when a platform doesn't
 *  override). */
const DEFAULT_INTERVAL_MIN = 1;
const DEFAULT_INTERVAL_MAX = 24;
const DEFAULT_INTERVAL_STEP = 1;

/** Kill the floating-point dust a repeated `+= step` accumulates (e.g.
 *  0.5 * 3), mirroring `fan.ts`'s own `tidy`. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Build the selectable interval grid from the entity's own bounds, mirroring
 *  `fan.ts`'s `runtimeOptions` exactly (same "always include the current
 *  value, even off-grid" guarantee, so the selector never hides the active
 *  setting). */
function intervalOptions(
  min: number,
  max: number,
  step: number,
  current: number,
  unit: IntervalUnit,
): IntervalOption[] {
  const values = new Set<number>([current]);
  if (step > 0 && max >= min) {
    for (let value = min; value <= max + 1e-9; value = tidy(value + step)) {
      values.add(tidy(value));
    }
  }
  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({
      value,
      label: formatIntervalUnit(value, unit),
      selected: value === current,
    }));
}

function buildIntervalEdit(
  hass: HomeAssistant,
  entityId: string | undefined,
): FilterIntervalEdit | null {
  if (!entityId) return null;
  const entity = hass.states[entityId];
  if (!entity || UNAVAILABLE.has(entity.state)) return null;
  const value = num(entity.state);
  if (value === null) return null;
  const unit = intervalUnitFromEntity(entity);
  const min = num(entity.attributes.min) ?? DEFAULT_INTERVAL_MIN;
  const max = num(entity.attributes.max) ?? DEFAULT_INTERVAL_MAX;
  const step = num(entity.attributes.step) ?? DEFAULT_INTERVAL_STEP;
  return { entityId, value, unit, options: intervalOptions(min, max, step, value, unit) };
}

export interface FurnaceFilterModel {
  /** False when `filter_last_changed_entity` is unset, missing, unavailable,
   *  or its state doesn't parse as a date — the Main Menu section is then
   *  hidden entirely (ADR-0001). */
  available: boolean;
  lastChanged: Date | null;
  /** The resolved interval, always expressed in exact whole days regardless of
   *  the source's own unit (`filter_interval_entity`'s `unit_of_measurement`
   *  may be days, weeks, or months — see `resolveInterval`) — derived from
   *  `dueDate` rather than the other way around, so a month-based interval
   *  stays calendar-correct rather than a fixed ~30-day approximation. `null`
   *  when neither `filter_interval_entity` nor `filter_interval_days`
   *  resolves — the due date / overdue state are then simply not shown. */
  intervalDays: number | null;
  dueDate: Date | null;
  /** True once today's local date is past `dueDate`. Always false when
   *  `dueDate` is null — there's nothing to be overdue against. */
  overdue: boolean;
  /** Whole days past `dueDate`, `0` unless `overdue`. */
  daysOverdue: number;
  /** Whether the "I've changed my filter" button has anything to call —
   *  `filter_reset_entity` configured, or `filter_last_changed_entity` itself
   *  on a directly-writable domain. False leaves the button disabled rather
   *  than silently doing nothing on tap. */
  canMarkChanged: boolean;
  /** Whether `filter_last_changed_entity` itself can be set to an arbitrary
   *  (not just today's) date directly from the section — its own domain is
   *  `input_datetime`/`date`/`datetime`. Narrower than `canMarkChanged`: a
   *  `filter_reset_entity` can only ever set "today" (it's an opaque
   *  button/script call, not a settable value), so it does not enable this. */
  canEditLastChanged: boolean;
  /** The live-editable interval, or `null` when there's nothing to edit
   *  (no `filter_interval_entity` configured, or it's currently unavailable/
   *  non-numeric) — see `FilterIntervalEdit`. */
  intervalEdit: FilterIntervalEdit | null;
}

export function toFurnaceFilterModel(
  hass: HomeAssistant,
  config: EcoseeCardConfig,
): FurnaceFilterModel {
  const unavailable: FurnaceFilterModel = {
    available: false,
    lastChanged: null,
    intervalDays: null,
    dueDate: null,
    overdue: false,
    daysOverdue: 0,
    canMarkChanged: false,
    canEditLastChanged: false,
    intervalEdit: null,
  };
  const entityId = config.filter_last_changed_entity;
  if (!entityId) return unavailable;
  const entity = hass.states[entityId];
  if (!entity || UNAVAILABLE.has(entity.state)) return unavailable;
  const lastChanged = parseFilterDate(entity.state);
  if (!lastChanged) return unavailable;

  const interval = resolveInterval(hass, config);
  const lastChangedStart = dayStart(lastChanged);
  const dueDate = interval ? addInterval(lastChangedStart, interval) : null;
  const intervalDays = dueDate ? daysBetween(lastChangedStart, dueDate) : null;
  const today = dayStart(new Date());
  const overdue = dueDate !== null && dueDate.getTime() < today.getTime();
  const daysOverdue = overdue && dueDate ? daysBetween(dueDate, today) : 0;
  const canEditLastChanged = WRITABLE_DATE_DOMAINS.has(domainOf(entityId));
  const canMarkChanged = Boolean(config.filter_reset_entity) || canEditLastChanged;

  return {
    available: true,
    lastChanged,
    intervalDays,
    dueDate,
    overdue,
    daysOverdue,
    canMarkChanged,
    canEditLastChanged,
    intervalEdit: buildIntervalEdit(hass, config.filter_interval_entity),
  };
}

/** Write `date` onto `entityId` directly, dispatched by its own domain — the
 *  shared implementation behind both `markFilterChangedCall` ("today") and
 *  `setLastChangedDateCall` (an arbitrary picked date). `null` when the
 *  entity's domain isn't one of the three directly-writable ones (matches
 *  `canEditLastChanged`/`WRITABLE_DATE_DOMAINS` above — a plain `sensor` has
 *  no service to call here). */
function writeLastChangedCall(entityId: string, date: Date): ServiceCall | null {
  const domain = domainOf(entityId);
  if (domain === 'input_datetime') {
    return {
      domain: 'input_datetime',
      service: 'set_datetime',
      data: { entity_id: entityId, date: toIsoDate(date) },
    };
  }
  if (domain === 'date') {
    return {
      domain: 'date',
      service: 'set_value',
      data: { entity_id: entityId, date: toIsoDate(date) },
    };
  }
  if (domain === 'datetime') {
    return {
      domain: 'datetime',
      service: 'set_value',
      data: { entity_id: entityId, datetime: date.toISOString() },
    };
  }
  return null;
}

/** Build the "I've changed my filter" write. Takes the two config entity ids
 *  directly (like `setHvacModeCall`/`setFanModeCall` take `entityId`) rather
 *  than the whole config, so the overlay component that calls this on tap can
 *  hold just the two id props it needs, not a full `EcoseeCardConfig`.
 *  `resetEntity` (a `button`/`script`) wins whenever configured — for a setup
 *  where `lastChangedEntity` is a read-only `sensor` computed elsewhere and
 *  needs an explicit trigger, not a direct write. Otherwise writes today's
 *  date straight onto `lastChangedEntity` via `writeLastChangedCall`. `null`
 *  when neither path is available — nothing to call (the button is disabled
 *  in that case, `canMarkChanged` above). */
export function markFilterChangedCall(
  lastChangedEntity: string | undefined,
  resetEntity: string | undefined,
): ServiceCall | null {
  if (resetEntity) {
    const domain = domainOf(resetEntity);
    if (domain === 'button') {
      return { domain: 'button', service: 'press', data: { entity_id: resetEntity } };
    }
    if (domain === 'script') {
      return { domain: 'script', service: 'turn_on', data: { entity_id: resetEntity } };
    }
    return null;
  }
  if (!lastChangedEntity) return null;
  return writeLastChangedCall(lastChangedEntity, new Date());
}

/** Build the write for manually editing `filter_last_changed_entity` to an
 *  arbitrary date (the section's own date-picker pill, `canEditLastChanged`)
 *  — unlike `markFilterChangedCall`, this never falls back to
 *  `filter_reset_entity`, since a reset entity is an opaque button/script
 *  trigger with no way to hand it a specific date. `null` when the entity's
 *  domain isn't directly writable. */
export function setLastChangedDateCall(entityId: string, date: Date): ServiceCall | null {
  return writeLastChangedCall(entityId, date);
}
