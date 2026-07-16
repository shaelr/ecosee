import type { HomeAssistant } from '../types/hass';
import type { EcoseeCardConfig } from '../config';
import { UNAVAILABLE } from '../climate/home-view';
import { comfortIconFor, type ComfortIcon } from '../climate/comfort-setting';
import type { ServiceCall } from '../climate/service-call';

/**
 * The derivation seam for the Schedule Overlay (ADR-0014). Backed by a `calendar`
 * entity representing the thermostat's weekly comfort-setting schedule as calendar
 * events — one event per contiguous run of the same comfort setting (e.g. an
 * ecobee integration's own Schedule calendar). This is a *paint*, not a delete,
 * model: every half-hour slot always belongs to some comfort setting, so there is
 * no "empty" state to create or remove into — only ever which comfort setting a
 * given stretch of time is painted with (confirmed against ha-ecobee's own
 * `calendar.py`: `DELETE_EVENT` is deliberately unsupported for exactly this
 * reason).
 *
 * Reads go through the `calendar.get_events` *service* (with `return_response`),
 * the same established pattern as `weather.get_forecasts` (ADR-0001) — the host
 * fetches on open / day change and threads the parsed events into
 * `toScheduleModel`, mirroring `toWeatherModel(hass, config, forecasts)`.
 *
 * Writes are different from every other seam in the Card: Home Assistant's
 * `calendar` domain only exposes `create_event` as an ordinary service —
 * `update_event` is websocket-only (`calendar/event/update`, confirmed against
 * `homeassistant/components/calendar/__init__.py`: no `UPDATE_EVENT_SERVICE` is
 * registered, only the websocket command). `moveBlockStart` / `removeBlock`
 * return that websocket message's payload rather than a `ServiceCall`.
 *
 * "Moving a block's start time" and "removing a block" are the same underlying
 * operation, painting-wise, and neither ever touches the block being edited by
 * calling `update_event` on *its own* uid in the shrink/remove direction — they
 * extend the *preceding* block's event instead. Growing a block backward (moving
 * its start earlier) *does* repaint the block's own footprint. This exactly
 * mirrors ha-ecobee's `time.py` `EcobeeComfortStartTime._move_start`:
 *
 *   if new_slot < old_slot:  # grow — repaint this block's own (now larger) span
 *   else:                    # shrink — repaint the PRECEDING block's span instead
 *
 * translated from that entity's raw `set_schedule_slots` calls to this Card's
 * `calendar/event/update` messages, since the calendar entity exposes no raw-slot
 * API of its own. A block whose start is only known because it was already
 * active at local midnight (`continuesFromPreviousDay`) has no in-day preceding
 * block to shrink into or merge with, so it is deliberately not editable here —
 * the transition that actually set it happened the day before, outside the
 * fetched window (Stage 1 scope; see ADR-0014).
 */

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The full weekday name for a `Date#getDay()`-style index (0=Sunday), for the
 *  Start Time picker's "on <Day>?" phrasing (owner-supplied reference screen). */
export function dayName(index: number): string {
  return DAY_NAMES[index] ?? '';
}

/** The ecobee schedule's own grid resolution — every write is snapped to this,
 *  matching the device (ha-ecobee's `time.py`/`calendar.py` both operate in
 *  30-minute slots; a submitted off-grid time is silently rounded server-side,
 *  so snapping here keeps the Card's displayed value from later disagreeing with
 *  what was actually applied). */
const SLOT_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;

/** One selectable day in the week strip, Sunday-first (matches `Date#getDay()`
 *  and the device's own S M T W T F S order). */
export interface ScheduleDayOption {
  index: number;
  label: string;
  selected: boolean;
}

/** One contiguous run of a single comfort setting on the selected day, already
 *  clamped to that day's [0, 1440) minute window. */
export interface ScheduleBlock {
  /** The calendar event's own uid — the write target for growing this block, or
   *  (via the preceding block) for shrinking/removing it. */
  uid: string;
  comfortSetting: string;
  icon: ComfortIcon;
  startMinutes: number;
  endMinutes: number;
  /** The block was already active at local midnight — its start label reads
   *  "From previous day" rather than a clock time, and it has no in-day
   *  preceding block, so it isn't independently editable here (see module doc). */
  continuesFromPreviousDay: boolean;
  /** The block runs through local midnight into the next day — its trailing
   *  label reads "Until next day" instead of the next block's start time. */
  continuesIntoNextDay: boolean;
}

export interface ScheduleModel {
  /** False when `schedule_entity` is unset, or the entity is missing/unavailable
   *  (ADR-0001 graceful degradation) — the Schedule Main Menu section is hidden. */
  available: boolean;
  days: ScheduleDayOption[];
  /** Empty while the day's events haven't been fetched yet (or the fetch
   *  returned nothing) — the Overlay shows its own loading/empty state rather
   *  than treating this as unavailable. */
  blocks: ScheduleBlock[];
}

/** A raw event as `calendar.get_events` reports it — plain ISO datetime strings
 *  (the *service* response shape; the REST `/api/calendars/...` endpoint nests
 *  these as `{dateTime: ...}` instead, but the Card never calls that endpoint). */
export interface RawScheduleEvent {
  uid: string;
  start: string;
  end: string;
  summary: string;
}

/** One `calendar/event/update` websocket message — the only write path
 *  `update_event` has (see module doc). Built by `moveBlockStart` / `removeBlock`;
 *  the host sends it via `hass.connection.sendMessagePromise`. */
export interface ScheduleUpdateMessage {
  type: 'calendar/event/update';
  entity_id: string;
  uid: string;
  event: { dtstart: string; dtend: string; summary: string };
}

export function scheduleDays(selectedIndex: number): ScheduleDayOption[] {
  return DAY_LABELS.map((label, index) => ({ index, label, selected: index === selectedIndex }));
}

/** Local midnight of `date` — the day boundary both the fetch window and every
 *  block's minute offsets are computed against. Uses the browser's own local
 *  timezone: the Card has no independent line on which timezone the Home
 *  Assistant *server* is configured for, so (like the rest of the Card) it
 *  assumes the dashboard is being viewed from the same timezone the thermostat
 *  itself is in — true for the overwhelming majority of installs (a home
 *  dashboard viewed from that same home). */
export function dayStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Format a `Date` as a naive (no UTC offset) local ISO string — the format
 *  Home Assistant's `cv.datetime` config validator accepts for both the
 *  `calendar.get_events` service and the `calendar/event/update` websocket
 *  command, interpreted in the Home Assistant server's own local timezone. */
function toLocalIso(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function fromDayMinutes(start: Date, minutes: number): string {
  return toLocalIso(new Date(start.getTime() + minutes * 60000));
}

/** Build the `calendar.get_events` call for one local day's schedule
 *  ([dayStart, dayStart + 24h)). Fetched as a service call with a response
 *  (mirroring `weather.get_forecasts` — see module doc); the host threads the
 *  parsed result into `toScheduleModel`. */
export function getScheduleEventsCall(entityId: string, start: Date): ServiceCall {
  const end = new Date(start.getTime() + MINUTES_PER_DAY * 60000);
  return {
    domain: 'calendar',
    service: 'get_events',
    data: {
      entity_id: entityId,
      start_date_time: toLocalIso(start),
      end_date_time: toLocalIso(end),
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Pull the event array for `entityId` out of a `calendar.get_events` response
 *  (`{ response: { <entity_id>: { events: [...] } } }`), defending against every
 *  missing layer so an unsupported/failed fetch degrades to no blocks rather
 *  than throwing (mirrors `parseForecastResponse`). */
export function parseScheduleResponse(response: unknown, entityId: string): RawScheduleEvent[] {
  const responses = record(response)?.response;
  const entity = record(responses)?.[entityId];
  const events = record(entity)?.events;
  if (!Array.isArray(events)) return [];

  const result: RawScheduleEvent[] = [];
  for (const raw of events) {
    const event = record(raw);
    const start = event?.start;
    const end = event?.end;
    const summary = event?.summary;
    if (typeof start !== 'string' || typeof end !== 'string' || typeof summary !== 'string') {
      continue;
    }
    const uid = event?.uid;
    result.push({ uid: typeof uid === 'string' ? uid : '', start, end, summary });
  }
  return result;
}

/** Turn one day's raw calendar events into the ordered, displayable blocks the
 *  Schedule Overlay renders. Events are re-sorted by start defensively — nothing
 *  in `calendar.get_events`'s contract guarantees an order, even though
 *  ha-ecobee's own implementation happens to return them schedule-ordered. */
export function toScheduleBlocks(
  events: RawScheduleEvent[],
  start: Date,
  config: EcoseeCardConfig,
): ScheduleBlock[] {
  const startMs = start.getTime();
  const endMs = startMs + MINUTES_PER_DAY * 60000;
  const sorted = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return sorted.map((event, index) => {
    const eventStartMs = Date.parse(event.start);
    const eventEndMs = Date.parse(event.end);
    const startMinutes = Math.max(0, Math.round((eventStartMs - startMs) / 60000));
    const endMinutes = Math.min(MINUTES_PER_DAY, Math.round((eventEndMs - startMs) / 60000));
    return {
      uid: event.uid,
      comfortSetting: event.summary,
      icon: comfortIconFor(event.summary, config),
      startMinutes,
      endMinutes,
      continuesFromPreviousDay: index === 0 && eventStartMs <= startMs,
      continuesIntoNextDay: index === sorted.length - 1 && eventEndMs >= endMs,
    };
  });
}

export function toScheduleModel(
  hass: HomeAssistant,
  config: EcoseeCardConfig,
  events: RawScheduleEvent[],
  selectedStart: Date,
  selectedDayIndex: number,
): ScheduleModel {
  const days = scheduleDays(selectedDayIndex);
  const entityId = config.schedule_entity;
  const entity = entityId ? hass.states[entityId] : undefined;
  if (!entityId || !entity || UNAVAILABLE.has(entity.state)) {
    return { available: false, days, blocks: [] };
  }
  return { available: true, days, blocks: toScheduleBlocks(events, selectedStart, config) };
}

/** Snap a minute-of-day value onto the schedule's 30-minute grid (see module
 *  doc), clamped into [0, 1440). */
export function snapToSlot(minutes: number): number {
  const snapped = Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.max(0, Math.min(MINUTES_PER_DAY - SLOT_MINUTES, snapped));
}

/** Build the websocket write that moves `blocks[blockIndex]`'s start time to
 *  `newStartMinutes` (already slot-snapped). Growing the block (an earlier
 *  start) repaints its own footprint; shrinking it (a later start) instead
 *  extends the *preceding* block to absorb the freed range — see module doc.
 *  `null` for a no-op move, or when the block has no in-day preceding block to
 *  shrink into (`continuesFromPreviousDay`, or it's the day's first block). */
export function moveBlockStart(
  entityId: string,
  blocks: ScheduleBlock[],
  blockIndex: number,
  start: Date,
  newStartMinutes: number,
): ScheduleUpdateMessage | null {
  const block = blocks[blockIndex];
  if (!block || block.continuesFromPreviousDay || newStartMinutes === block.startMinutes) {
    return null;
  }

  if (newStartMinutes < block.startMinutes) {
    return {
      type: 'calendar/event/update',
      entity_id: entityId,
      uid: block.uid,
      event: {
        dtstart: fromDayMinutes(start, newStartMinutes),
        dtend: fromDayMinutes(start, block.endMinutes),
        summary: block.comfortSetting,
      },
    };
  }

  const previous = blocks[blockIndex - 1];
  if (!previous || newStartMinutes >= block.endMinutes) return null;
  return {
    type: 'calendar/event/update',
    entity_id: entityId,
    uid: previous.uid,
    event: {
      dtstart: fromDayMinutes(start, previous.startMinutes),
      dtend: fromDayMinutes(start, newStartMinutes),
      summary: previous.comfortSetting,
    },
  };
}

/** Build the websocket write that removes `blocks[blockIndex]` from the
 *  schedule by merging it into the block before it — there is no delete (see
 *  module doc); "removing" a block is extending its predecessor's event to
 *  cover the removed block's own range too. `null` when there's no in-day
 *  preceding block to merge into. */
export function removeBlock(
  entityId: string,
  blocks: ScheduleBlock[],
  blockIndex: number,
  start: Date,
): ScheduleUpdateMessage | null {
  const block = blocks[blockIndex];
  const previous = blocks[blockIndex - 1];
  if (!block || !previous || block.continuesFromPreviousDay) return null;
  return {
    type: 'calendar/event/update',
    entity_id: entityId,
    uid: previous.uid,
    event: {
      dtstart: fromDayMinutes(start, previous.startMinutes),
      dtend: fromDayMinutes(start, block.endMinutes),
      summary: previous.comfortSetting,
    },
  };
}

/** Build the `calendar.create_event` call that adds a new block to the selected
 *  day, painting `[startMinutes, endMinutes)` with `comfortSetting` — an
 *  ordinary service call, unlike `moveBlockStart`/`removeBlock`'s websocket
 *  write (`create_event`, unlike `update_event`, IS a plain service — see
 *  module doc). Whatever block(s) currently occupy that range are implicitly
 *  trimmed to make room, the same paint-repaints-only-its-own-footprint model
 *  every write in this module uses — no separate "make space" step. `null` for
 *  an empty or inverted range (`endMinutes <= startMinutes`): a new block is
 *  same-day here, matching the Add Block screen's own two same-day time
 *  fields — it can't wrap past midnight the way an existing block can. */
export function addBlockCall(
  entityId: string,
  comfortSetting: string,
  start: Date,
  startMinutes: number,
  endMinutes: number,
): ServiceCall | null {
  if (endMinutes <= startMinutes) return null;
  return {
    domain: 'calendar',
    service: 'create_event',
    data: {
      entity_id: entityId,
      summary: comfortSetting,
      start_date_time: fromDayMinutes(start, startMinutes),
      end_date_time: fromDayMinutes(start, endMinutes),
    },
  };
}

/** Build the `calendar.create_event` calls that copy the selected day's whole
 *  arrangement onto `targetStart` — one call per source block, each painting
 *  its own `[start, end)` on the target day with its own comfort setting.
 *  Blocks are contiguous and gap-free by construction (every minute of a day
 *  belongs to some block), so painting all of them fully overwrites whatever
 *  the target day previously held — no separate "clear the day" step, the same
 *  paint-only model every write in this module uses. Each block's minute
 *  offsets are reapplied relative to `targetStart`'s own midnight, not the
 *  source day's actual date — copying never needs to know or preserve
 *  cross-day continuity (`continuesFromPreviousDay` / `continuesIntoNextDay`),
 *  since a block's `[startMinutes, endMinutes)` is already expressed purely in
 *  terms of its own day. */
export function copyDayCalls(
  entityId: string,
  sourceBlocks: ScheduleBlock[],
  targetStart: Date,
): ServiceCall[] {
  return sourceBlocks.map((block) => ({
    domain: 'calendar',
    service: 'create_event',
    data: {
      entity_id: entityId,
      summary: block.comfortSetting,
      start_date_time: fromDayMinutes(targetStart, block.startMinutes),
      end_date_time: fromDayMinutes(targetStart, block.endMinutes),
    },
  }));
}
