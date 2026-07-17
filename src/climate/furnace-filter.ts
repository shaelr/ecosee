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

function parseFilterDate(state: string): Date | null {
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

/** `"YYYY-MM-DD"` from local date components (not `toISOString`, which
 *  converts to UTC first — the same local-date convention Schedule's own
 *  `toLocalIso` uses, schedule.ts). */
function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The interval, in days, from `filter_interval_entity` when it currently has
 *  a valid positive reading — `undefined`/unavailable/non-numeric/non-positive
 *  all fall through to `filter_interval_days` (or "no interval known") in
 *  `toFurnaceFilterModel`, mirroring `min_gap_entity`'s own fallback shape. */
function intervalFromEntity(hass: HomeAssistant, entityId: string | undefined): number | null {
  if (!entityId) return null;
  const entity = hass.states[entityId];
  if (!entity || UNAVAILABLE.has(entity.state)) return null;
  const value = num(entity.state);
  return value !== null && value > 0 ? value : null;
}

export interface FurnaceFilterModel {
  /** False when `filter_last_changed_entity` is unset, missing, unavailable,
   *  or its state doesn't parse as a date — the Main Menu section is then
   *  hidden entirely (ADR-0001). */
  available: boolean;
  lastChanged: Date | null;
  /** `null` when neither `filter_interval_entity` nor `filter_interval_days`
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
  };
  const entityId = config.filter_last_changed_entity;
  if (!entityId) return unavailable;
  const entity = hass.states[entityId];
  if (!entity || UNAVAILABLE.has(entity.state)) return unavailable;
  const lastChanged = parseFilterDate(entity.state);
  if (!lastChanged) return unavailable;

  const intervalDays =
    intervalFromEntity(hass, config.filter_interval_entity) ?? config.filter_interval_days ?? null;
  const dueDate = intervalDays !== null ? addDays(dayStart(lastChanged), intervalDays) : null;
  const today = dayStart(new Date());
  const overdue = dueDate !== null && dueDate.getTime() < today.getTime();
  const daysOverdue =
    overdue && dueDate ? Math.round((today.getTime() - dueDate.getTime()) / 86400000) : 0;
  const canMarkChanged =
    Boolean(config.filter_reset_entity) || WRITABLE_DATE_DOMAINS.has(domainOf(entityId));

  return {
    available: true,
    lastChanged,
    intervalDays,
    dueDate,
    overdue,
    daysOverdue,
    canMarkChanged,
  };
}

/** Build the "I've changed my filter" write. Takes the two config entity ids
 *  directly (like `setHvacModeCall`/`setFanModeCall` take `entityId`) rather
 *  than the whole config, so the overlay component that calls this on tap can
 *  hold just the two id props it needs, not a full `EcoseeCardConfig`.
 *  `resetEntity` (a `button`/`script`) wins whenever configured — for a setup
 *  where `lastChangedEntity` is a read-only `sensor` computed elsewhere and
 *  needs an explicit trigger, not a direct write. Otherwise writes today's
 *  date straight onto `lastChangedEntity`, if its own domain supports it.
 *  `null` when neither path is available — nothing to call (the button is
 *  disabled in that case, `canMarkChanged` above). */
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

  const target = lastChangedEntity;
  if (!target) return null;
  const domain = domainOf(target);
  const today = new Date();
  if (domain === 'input_datetime') {
    return {
      domain: 'input_datetime',
      service: 'set_datetime',
      data: { entity_id: target, date: toIsoDate(today) },
    };
  }
  if (domain === 'date') {
    return {
      domain: 'date',
      service: 'set_value',
      data: { entity_id: target, date: toIsoDate(today) },
    };
  }
  if (domain === 'datetime') {
    return {
      domain: 'datetime',
      service: 'set_value',
      data: { entity_id: target, datetime: today.toISOString() },
    };
  }
  return null;
}
