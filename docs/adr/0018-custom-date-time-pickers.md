# Custom date/time pickers

**Status: Accepted.** Origin: owner request, after ADR-0017's `showPicker()`/
`.focus()` fix (v0.24.9) got the native date/time pickers working reliably
across desktop and iOS but left the browser's own picker chrome in place:
"can we replace the pickers and the calendar picker with our own overlays
that fit the styling of the rest of the card. when i say overlay i think it
should act as the other overlays do and take over the entire card."

**Supersedes ADR-0017's native-picker approach** for the three fields it
covered (Furnace Filter's Last Changed, Schedule's Start/End when adding a
block, and a schedule block's own Start Time) — not a reversal of anything
ADR-0017 got wrong (the `.focus()`/`showPicker()` fix it landed on was
correct and is preserved in git history), but a decision to stop relying on
native browser/OS picker chrome for these fields at all, eliminating the
whole category of cross-engine risk ADR-0017 spent five corrections
chasing.

## Context

By the end of ADR-0017's corrections, the native-picker architecture worked
correctly on every engine tested — but only after five rounds of real-device
findings (Chrome desktop bleed-through, mobile WebKit's opacity heuristic, a
`showPicker()`-forces-open desktop fix, and finally the iOS
`showPicker()`-is-unimplemented discovery) and it still carried two
unresolved, documented rough edges: the Furnace Filter calendar popup
mis-anchoring against the Card's own `transform: scale(...)` architecture,
and — the trigger for this ADR — every browser/OS rendering its own,
uncustomizable picker chrome. The owner, having seen iOS's native picker
sheet (checkmark, Reset button) and Chrome's plainer one side by side,
wanted one consistent, ecosee-styled picker everywhere instead of "whatever
the platform feels like showing."

Two interaction models needed deciding before building anything, resolved
directly with the owner:

- **Time picker** (Schedule's Start/End, a block's Start Time): a two-column
  scrollable Hour (00–23) / Minute (00/30, the schedule's own 30-minute grid)
  picker, confirmed via an explicit ✓ button — asked directly rather than
  assumed, since two independent selections can't cleanly auto-confirm on a
  single tap the way a one-column picker can (picking only the hour isn't
  yet a complete value).
- **Date picker** (Furnace Filter's Last Changed): tap a day to confirm and
  close immediately, no separate button — also asked directly, since the
  owner's first instinct (matching the iOS reference) was an explicit
  confirm step too. Resolved to the simpler one-tap model on the reasoning
  that "a way to back out of it" — the owner's own stated requirement — is
  already satisfied by the shell's ✕, which (per the app's own v0.24.6
  convention) never writes anything and is the universal cancel on every
  Overlay already; no new mechanism was needed to satisfy it.

### The state-lifting wrinkle

`schedule-add-block-overlay.ts` held its in-progress Comfort Setting/Start/
End as local `@state`. Pushing the new time picker on top of it to edit
Start or End would unmount it — only the top-of-stack Overlay is ever
mounted (`_renderOverlay`'s own render contract) — losing any in-progress,
uncommitted edit the moment the user picked a time and came back. Fixed by
lifting that state to the card (`_addBlockComfortSetting`/
`_addBlockStartMinutes`/`_addBlockEndMinutes`), matching how
`_scheduleEditingBlockIndex` and every other per-open-seed already lives
there — `schedule-add-block-overlay.ts` becomes a fully controlled
component, the same shape `schedule-start-time-overlay.ts` already was.

### The nav-depth wrinkle

The time picker is reached from three different screens at two different
stack depths, with two different correct close behaviors: opened from Add to
Schedule, confirming should pop one level back to that screen (the new block
isn't submitted until its own button is tapped); opened from a schedule
block's own Start Time screen, confirming should apply the write and land
directly on Schedule — skipping back through the Start Time screen — exactly
matching the pre-existing native-input behavior. But the time picker is now
a **third** stack level in that second case
(`['schedule', 'schedule-start-time', 'time-picker']`), where the old
`_closeOverlay()` (`_nav.slice(0, -1)`) would land one level short, on the
Start Time screen instead of Schedule. Fixed with a depth-agnostic
`_closeToSchedule()` that pops to the named `'schedule'` level by searching
`_nav` for it, rather than assuming a fixed relative depth — correct whether
the write was reached 2 or 3 levels deep.

## Decision

- Two new Overlay components, `time-picker-overlay.ts` and
  `date-picker-overlay.ts`, pushed onto the nav stack exactly like any other
  picker (`'time-picker'`/`'date-picker'` `OverlayKind`s) — full-card
  takeover, dismissed only by the shell's ✕, styled entirely in the existing
  design language (the segmented-list/selected-row treatment
  `system-mode-overlay.ts`/`comfort-setting-overlay.ts` already use, the
  `.confirm` button `schedule-add-block-overlay.ts` already has, the
  day-circle/today-dot language `schedule-overlay.ts`'s own day strip
  already has). Neither imports `tokens`/`shapeStyles` — like every existing
  picker, they're plain slotted content inside `<ecosee-overlay>`, which
  already draws the shared shell.
- `calendar-math.ts` is the one new pure, unit-tested module the feature
  needed: `buildCalendarGrid`/`isSameDay`/`isAfterDay`, the month-grid layout
  math (leading/trailing days from adjacent months, leap years, weekday
  offsets) — no HA-parsing involved, so it isn't a `climate`/`schedule` seam,
  just a presentation-support module living next to its one consumer.
- `furnace-filter-overlay.ts`, `schedule-add-block-overlay.ts`,
  `schedule-start-time-overlay.ts` each lost every trace of the native-input
  architecture — `.pill-button`/hidden-input pairs, `@query`, `.focus()`/
  `showPicker()` calls, all of it — replaced with a plain button emitting an
  open event (`ecosee-date-picker-open`, or `ecosee-time-picker-open` with a
  `target` identifying which of the three call sites asked). `ecosee-card.ts`
  is the only place that knows how to route each target's confirm back to
  the right place; the three source components stayed exactly as
  presentational as they were before, just with a native-API surface removed
  rather than added.
- `schedule-add-block-overlay.ts`'s `comfortSetting`/`startMinutes`/
  `endMinutes` moved from local `@state` to `@property`, owned by the card
  (see "the state-lifting wrinkle" above); its own `_confirm()` and the
  `ecosee-schedule-add-block-confirm` event contract are otherwise unchanged.
- `_applyScheduleWrite` (the Start Time confirm / Remove write-then-close
  path) now closes via `_closeToSchedule()` instead of `_closeOverlay()` (see
  "the nav-depth wrinkle" above); `_onScheduleTimeConfirm` is retired, its
  logic folded into `_onTimePickerConfirm`'s `'schedule-start-time'` branch.

## Consequences

- The Furnace Filter calendar's popup-mis-anchoring rough edge (ADR-0017)
  is moot for this field now — there is no native popup left to mis-anchor.
  It remains real for any future native date/time input this Card might add
  elsewhere.
- The picker now looks and behaves identically on every platform — the
  actual goal — at the cost of a modest amount of new UI surface (two
  components, one pure math module) this Card now owns and maintains
  instead of delegating to the browser.
- `_timePickerTarget`'s three-way branch (`'add-block-start'` /
  `'add-block-end'` / `'schedule-start-time'`) is the one place a fourth
  future time-editing field would need a new case — the same shape
  `OverlayDescriptor`'s table already keeps every other Overlay's wiring
  in one place, so this isn't a new kind of coupling, just this feature's
  own instance of the existing pattern.
