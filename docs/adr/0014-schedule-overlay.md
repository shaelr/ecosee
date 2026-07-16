# Schedule Overlay

**Status: Accepted.** Origin: owner request, following up on `min_gap_entity`
(sourcing the Auto deadband from an ecobee integration's own sensor): "the
ha-ecobee also includes scheduling abilities to change what time the comfort
settings change, as well as changing comfort setting set points. can we
incorporate that into the card as well?"

## Context

Investigating `shaelr/ha-ecobee` (the owner's own ecobee integration fork)
turned up three genuinely different capabilities bundled under "scheduling":

1. **Per-comfort-setting temperatures** — a `number` entity pair (Heat/Cool) for
   every comfort setting, including custom ones (`EcobeeComfortTemp`,
   `number.py`).
2. **A daily start-time convenience entity** — a `time` entity, but only for
   **Home** and **Sleep** specifically (`EcobeeComfortStartTime`, `time.py`):
   moving it shifts that comfort setting's first transition on all 7 schedule
   days at once. The integration's own comment is explicit about why it's
   restricted to those two: "a single 'start time' only cleanly represents a
   comfort setting that occupies one clean block per day."
3. **The full weekly schedule** — a `calendar` entity (`EcobeeScheduleCalendar`,
   `calendar.py`) representing the ecobee's raw 7-day × 48-half-hour-slot
   schedule as calendar events, one event per contiguous run of a comfort
   setting. Painting semantics, not delete: "every half-hour slot in the ecobee
   schedule always belongs to some comfort setting... `DELETE_EVENT` is
   intentionally not supported."

(1) is deferred to a later stage — it extends the existing Comfort Setting
picker and needs its own per-preset entity-mapping config, an unrelated
surface. (3) is what this ADR covers, and it subsumes (2): the calendar
entity's per-day, per-comfort-setting granularity is a strict superset of the
all-7-days convenience entity, and the owner's own reference screenshots (the
real ecobee app's Schedule screen) edit a block's start time **per individual
day**, not all seven at once — matching the calendar's own model, not the
`time.py` entity's.

### Why not a 7×48 grid in the Card itself

The calendar's raw model is a dense weekly grid, but the ecobee app's actual UI
(owner-supplied screenshots) never shows it that way: one day at a time, as a
short vertical agenda of a handful of **blocks** (contiguous runs), each
preceded by a boundary label — a clock time, or "From previous day" for a block
already active at midnight — with a trailing "Until next day" after the last
one. Tapping a block opens a single time field ("What time do you go to bed on
Thursday?") plus "Remove from schedule"; there's no free-form drag-to-paint in
the reference UI at all. This is what the Schedule Overlay replicates — a
day strip (S M T W T F S) above the day's block agenda — rather than inventing
a denser grid interaction this Card's fixed 460×460 canvas has no good format
for anyway.

### Why "remove" is a merge, not a delete

Matching the calendar's own paint-only model (see Context): "removing" a block
is extending the block **before** it to also cover the removed block's range —
there is no delete call anywhere in this feature. A block that continues from
the previous day (`ScheduleBlock.continuesFromPreviousDay`) has no in-day
predecessor to merge into or shrink from — the transition that actually set it
happened the day before, outside the fetched window — so it renders without a
chevron and isn't independently editable in Stage 1.

### The write path has no service for updates

Every other Overlay in this Card writes via `hass.callService` — a single,
uniform apply path (`ecosee-service-call`, one event, one handler). Schedule
breaks that uniformity: Home Assistant's `calendar` domain registers
`create_event` and `get_events` as ordinary services (confirmed against
`homeassistant/components/calendar/__init__.py`:
`component.async_register_entity_service(...)` for both), but **not**
`update_event` — that exists only as the `calendar/event/update` websocket
command. Moving a block's start time or removing it is always an update (the
event already exists; only the underlying calendar entity's automatic
recompute produces the calendar's DERIVED "new" event on the next fetch), so
this feature needed the Card's first-ever websocket write
(`hass.connection.sendMessagePromise`, `types/hass.ts`).

Reads use the established service-with-response pattern instead
(`calendar.get_events` with `return_response`), identical in shape to
`weather.get_forecasts` — confirmed via `SERVICE_GET_EVENTS`/
`async_get_events_service` in the same HA core source, registered exactly like
`create_event`, with a response shape (`{ response: { <entity_id>: { events:
[...] } } }`) that mirrors `weather.get_forecasts`'s own envelope closely
enough that `parseScheduleResponse` is structurally the same function as
`parseForecastResponse`.

## Decision

- **New config key**: `schedule_entity` (a `calendar.*` entity id). No
  per-comfort-setting entity mapping is needed for this feature — the calendar
  model keys everything off the comfort setting's plain name (`summary`), the
  same string `preset_mode`/`preset_modes` already use, so `schedule.ts` reuses
  `comfort-setting.ts`'s icon-resolution table directly (`comfortIconFor`,
  newly exported) rather than duplicating it.
- **New Main Menu section**, `schedule`, added to `TAB_SECTIONS` alongside
  System/Sensors/Fan — reachable via the persistent tab bar like the other
  three, hidden when `schedule_entity` is unset (ADR-0001 graceful
  degradation). A Card addition, not a physical-device tab (`menu/tab-bar.ts`'s
  own doc now notes this explicitly, matching how Weather is already a
  Home-Screen-only addition with no device equivalent).
- **`src/schedule/schedule.ts`** is the seam, the same shape as every other
  (`toScheduleModel(hass, config, events, selectedStart, selectedDayIndex)`,
  mirroring `toWeatherModel`'s `forecasts` parameter for the same reason: the
  data comes from an async fetch the host performs on open/day-change, not
  from `hass.states` alone). `moveBlockStart` / `removeBlock` are pure
  functions computing the `calendar/event/update` payload from the day's
  already-derived blocks — translated from `ha-ecobee`'s own `time.py`
  `_move_start` logic (grow the edited block's own footprint; shrink by
  extending the *preceding* block's footprint instead, since only the touched
  footprint gets repainted and nothing else reverts automatically) to calendar
  create/update-event semantics, since the calendar entity exposes no raw-slot
  write API of its own.
- **Timezone**: day boundaries use the browser's own local time (`dayStart`,
  `toLocalIso`), not any Home Assistant server timezone the Card has no
  independent line on — the same assumption the rest of the Card already makes
  implicitly (a dashboard is viewed from the same timezone its thermostat is
  in). Documented as a known limitation in `schedule.ts`'s own doc comment
  rather than solved with added complexity Stage 1 doesn't need.
- **Stage 1 scope** (owner-confirmed): view a day's blocks, move an editable
  block's start time, remove an editable block. Deliberately deferred:
  adding a brand-new block (no comfort-setting-picker step designed yet),
  "copy schedule to another day", and paging between weeks (the day strip
  always shows the current Sunday-through-Saturday week).

## Consequences

- `types/hass.ts`'s `HomeAssistant.connection` is the Card's first websocket
  surface, typed narrowly (`sendMessagePromise` only) and optional, matching
  every other `hass` capability this Card treats as something a seam test can
  omit (ADR-0001's degrade-gracefully spirit extended to the test-fixture
  shape, not just runtime behavior).
- `schedule-overlay.ts` (the day strip + block agenda) and
  `schedule-start-time-overlay.ts` (the picker) follow the established
  hub-and-picker shape exactly: `schedule` is a Main Menu section like `system`
  is, `schedule-start-time` is a picker it routes to exactly like
  `system-mode`/`comfort-setting` are, both reached and dismissed through the
  same single `_open`/`_closeOverlay` machinery every other Overlay uses.
- Block rows render as the Skin's existing cyan-outlined squircle card
  language (matching Sensors' cards) rather than the reference app's own
  per-comfort-setting fill colors — this Skin has no established
  per-comfort-setting color palette (Heat/Cool amber/blue is a *setpoint*
  language, unrelated to comfort-setting identity, and an arbitrary custom
  preset name has no color of its own to draw from without inventing one).
- `_scheduleDayIndex` / `_scheduleEvents` are deliberately **not** cleared on
  close (unlike `_tempSeed` / `_weatherForecasts`) — returning to a
  previously-viewed day is more useful than always snapping back to today, and
  showing the last-fetched blocks immediately on reopen (rather than a blank
  "Loading…" flash) matches how little this data actually changes day to day.

## Stage 2: add a block, copy a day

The two pieces Stage 1 deliberately deferred, added once Stage 1 was verified
working end-to-end (including catching and fixing an unrelated, pre-existing
`ha-ecobee` bug along the way: `SCHEDULE_WEEKDAY_TO_ECOBEE_DAY_INDEX_OFFSET`
assumed `program.schedule[0]` was Sunday, per that code's own "unverified"
comment; a Thursday edit landing on Friday on the real device confirmed it's
actually Monday, fixed upstream in `ha-ecobee`, not in this Card).

- **Add a block** (`schedule-add-block-overlay.ts`, the "+"): a Comfort
  Setting selector plus start/end time fields, confirming into
  `schedule.ts`'s `addBlockCall` — a single `calendar.create_event` call
  painting `[start, end)` with the chosen comfort setting. Unlike
  `moveBlockStart`/`removeBlock`, `create_event` **is** an ordinary service
  (see the module doc's `update_event`-has-no-service-equivalent finding), so
  this reuses `hass.callService` directly rather than the websocket path.
  Deliberately same-day only (`endMinutes` must exceed `startMinutes`) —
  matching the two plain time fields, and keeping this a single screen rather
  than needing its own day picker on top of Schedule's.
- **Copy schedule to another day** (`schedule-copy-overlay.ts`): a multi-select
  checklist of the other six days (the source day is excluded — copying onto
  itself is a no-op with nothing to confirm), confirming into `copyDayCalls` —
  one `create_event` per source block, per checked target day. Blocks are
  contiguous and gap-free by construction (every minute of a day belongs to
  some block), so painting all of a day's blocks onto another day fully
  overwrites it with no separate "clear the day" step, the same paint-only
  model every Schedule write in this ADR uses. Each block's minute offsets are
  re-anchored to the *target* day's own midnight — copying never needs to
  reason about the source day's actual calendar date, only its shape.
- The six-row day checklist doesn't fit the remaining canvas height alongside
  the title/subtitle/confirm button — caught visually (a Playwright screenshot
  showed Friday/Saturday cut off below the frame) after the interaction itself
  tested fine, because a scripted test can click a hidden element that a real
  finger can't reach. `.days` scrolls internally now (`max-height` +
  `overflow-y: auto`, matching `.agenda`'s own pattern in
  `schedule-overlay.ts`), with `flex: none` on each row so the scrolling flex
  column can't compress them instead of scrolling — the same lesson ADR-0013's
  and prior sessions' sizing fixes keep re-teaching: a script driving the DOM
  directly proves the *event wiring* works, not that the *layout* does.
- **Owner-reported**: the Add Block screen's confirm button was cut off at the
  bottom on a real device. `.picker` is a *fixed* 460×460 box (not
  content-sized), and `.confirm` reaches the bottom via `margin-top: auto` in
  a column flex layout — which pins it flush with the box's bottom edge only
  when the content above fits; if it doesn't, those items overflow the fixed
  box (an explicit `height` doesn't grow to its children) and get clipped by
  the shell's `overflow: hidden`, while `.picker`'s own measured rect stays
  unchanged, which is why a synthetic Playwright rect check (short labels, no
  overflow in that specific run) didn't reproduce it. Fixed by tightening the
  screen's vertical rhythm (less padding, smaller gaps, smaller title/subtitle
  type) for headroom, and — the more load-bearing part — giving `.fields` the
  same `max-height` + `overflow-y: auto` safety net as `.days` above, so a
  longer comfort-setting label or different font metrics scroll the field list
  internally instead of ever pushing `.confirm` past the box again.
