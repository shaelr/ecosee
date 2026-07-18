# Furnace Filter

**Status: Accepted.** Origin: owner request, alongside a reference screenshot
of the ecobee app's own filter-change confirmation screen: "ive updated the
ecobee integration with a few additions for the furnace filter. can we change
the left icon '22' in the menu to be a menu for the furnace filter. this menu
will include the last change date, the interval, and at the bottom a big
button to mark that the filter has been changed, like in the ecobee app."

## Context

The physical ecobee device has no furnace-filter screen of its own — this is
a pure Card addition, backed by whatever the owner's own `ha-ecobee` fork (or
any other integration/helper setup) exposes for it. Unlike Comfort Setpoints
(ADR-0015), which has one confirmed upstream shape (`EcobeeComfortTemp`'s
`number` entity pair), the owner's filter-tracking entities are a personal
fork addition with no single canonical shape — "maybe its best to add
configuration options in the card for this since this can vary from user to
user." The seam is therefore designed against generic Home Assistant entity
domains (`date`, `datetime`, `input_datetime`, `button`, `script`, or a
read-only `sensor`) rather than one specific integration's entity ids,
matching the Card's own generic-by-design stance (ADR-0001).

### Why the tab-bar left slot, not a new independent tab

The owner's original ask named a specific existing element: "the left icon
'22' in the menu" — the tab bar's temperature badge, which returned to the
Home Screen when tapped. Replacing it (rather than adding a sixth tab
alongside it) was confirmed directly: asked whether to keep the badge
alongside a new Furnace Filter tab or replace it outright, the owner chose
**"replace the '22' badge as we[since] that icon is redundant to the X in the
top left."** This holds structurally: every Main Menu section opens via the
same `_open(kind, 'home')` call (`ecosee-card.ts`), so dismissing any section
— via the shell's own ✕ — already lands on the identical bare Home Screen the
badge's `_revertToHome()` call did. The badge was a second path to a
destination the shell's own chrome already reaches; removing it costs nothing
functionally and frees the tab bar's leftmost slot for a section that didn't
have one.

### Why writes go through the same `ecosee-service-call` path as everything else

`markFilterChangedCall` (`climate/furnace-filter.ts`) is a pure function like
every other overlay's call-builder (`setHvacModeCall`, `setFanModeCall`,
`setNumberValueCall`, …) — it takes the two entity ids the "I've changed my
filter" button needs (`filter_last_changed_entity`, `filter_reset_entity`)
and returns a plain `ServiceCall`, which `furnace-filter-overlay.ts` emits
through the shared `ecosee-service-call` event on tap, exactly like
`fan-overlay.ts`'s mode buttons or `system-mode-overlay.ts`'s rows. No new
event or host-side write path was needed.

### Entity-domain dispatch, confirmed against `home-assistant/core`

Two independent entities cooperate, with the reset entity (when configured)
taking priority — for a setup where `filter_last_changed_entity` is a
read-only `sensor` computed elsewhere (an automation, a template) and needs
an explicit trigger rather than a direct write:

- `filter_reset_entity` set → `button.press` (`{entity_id}` only) or
  `script.turn_on` (`{entity_id}`, no `variables` needed here), by the
  entity's own domain prefix.
- Otherwise, `filter_last_changed_entity` is written to directly if its
  domain supports it: `input_datetime.set_datetime` (`{date: "YYYY-MM-DD"}` —
  only the date-relevant field the helper's own `has_date`/`has_time` config
  actually uses), `date.set_value` (`{date: "YYYY-MM-DD"}`), or
  `datetime.set_value` (`{datetime: <ISO 8601 with an explicit UTC offset>}`,
  which raises `ValueError` server-side without one — `Date.toISOString()`
  always carries one). A `sensor` (or any other domain) can't be written to
  directly; `canMarkChanged` is `false` in that case unless a reset entity is
  also configured, and the button renders disabled rather than silently
  doing nothing on tap.

### The date-only UTC-midnight parsing gotcha

`date`/`input_datetime`'s date-only state format is a bare `"YYYY-MM-DD"`,
naming a **wall-clock calendar date**, not an instant. `new Date("YYYY-MM-DD")`
parses per ECMA-262 as UTC midnight, though — which `dayStart` (reused from
`schedule.ts` for local-midnight day-boundary math, ADR-0014's own
convention) would then roll back one calendar day for any install west of
UTC, silently miscounting the due date and overdue state. `parseFilterDate`
special-cases the bare-date form, parsing its `Y`/`M`/`D` components directly
into a local `Date` instead of routing it through the UTC-parsing
constructor. This was caught by the seam's own unit tests (an "overdue by 5
days" assertion consistently came back 6 in this environment, UTC−4) before
it ever reached a user.

## Decision

- **Four new config keys** (all optional; the section is hidden — ADR-0001 —
  until at least `filter_last_changed_entity` is set and resolves):
  `filter_last_changed_entity` (a `date`/`datetime`/`input_datetime`/`sensor`
  entity), `filter_interval_days` (a plain positive number of days),
  `filter_interval_entity` (a `number` entity, mirroring the
  `min_gap`/`min_gap_entity` fixed-value-with-live-override pattern —
  preferred over `filter_interval_days` whenever it has a valid positive
  reading, falling back otherwise), and `filter_reset_entity` (a
  `button`/`script`). Kept snake_case, unchanged from the original proposal,
  per explicit owner confirmation ("no no, the way you have it is right.
  keep it the same") after a naming-ambiguity check.
- **`src/climate/furnace-filter.ts`** is the seam:
  `toFurnaceFilterModel(hass, config)` resolves `lastChanged`, `intervalDays`,
  the computed `dueDate`, `overdue`/`daysOverdue` (whole days, local-midnight
  comparison), and `canMarkChanged`; `markFilterChangedCall` builds the write
  as described above. "Today" is read once via `new Date()` inside the seam
  itself (unlike Schedule's `todayIndex`, which the host passes in) since
  there is no render-time component boundary here to keep pure/testable
  across — the seam itself is already the unit-tested boundary, called fresh
  on every render the same way every other `to*Model` function is.
- **The tab bar's temperature badge is removed** (`menu/tab-bar.ts`,
  `overlays/overlay-shell.ts`): `TabTarget` collapses to exactly
  `TabSection` (no more `'thermostat'` case), and `'filter'` joins
  `TAB_SECTIONS` in the badge's old leftmost slot. A new glyph
  (`icons.filter`, a pleated-panel rectangle) since none of the existing
  icons read as "filter."
- **`furnace-filter-overlay.ts`** renders the section: a "Furnace Filter"
  title, the last-changed/due-date readout (the due-date row and an explicit
  "Overdue by N days" line switch to the Heat-setpoint amber once overdue —
  color plus text, not color alone), and the "I've changed my filter" button.
  The button fills with the Skin's own cyan accent (matching
  `fan-overlay.ts`'s selected segment / `system-mode-overlay.ts`'s active
  row) rather than the ecobee app's literal green — the reference screen
  supplied the *layout and purpose* of the control, not a mandate to break
  the Skin's established single-accent language for one button.

## Consequences

- `TabBarModel.temp` is gone; `toTabBarModel` no longer takes a temperature
  argument. `ecosee-card.ts`'s `_tabBar()` no longer reads `HomeView` at all
  (the only thing it read was the badge temperature), so it dropped its
  `view` parameter; `formatTemp` became an unused import there as a result
  and was removed.
- `_onTabSelect` simplifies to an unconditional `_open(target, 'home')` — the
  `target === 'thermostat'` branch and its direct `_revertToHome()` call are
  gone. `_revertToHome()` itself is untouched and still runs from the
  inactivity-timer auto-revert path (`InactivityTimer`), which never went
  through the tab bar.
- A config with no `filter_last_changed_entity` set (the overwhelming
  majority of existing installs, pre-upgrade) sees no behavior change beyond
  the tab bar's leftmost slot simply having one fewer item — there is no
  longer a badge there, and no Furnace Filter tab either, since the section
  isn't reachable (ADR-0001).

## Correction (post-ship): the icon under the title was dropped

**Origin**: owner-reported overflow, with a real-device screenshot — the
overdue readout's three lines plus the button crowded the tab bar on an
actual dashboard render. The section originally opened with a large copy of
`icons.filter` beneath the title (mirroring how a couple of the earlier Main
Menu sections lead with a glyph); the owner's own diagnosis was direct:
"we can get rid of the icon at the top under the title. that should free up
some space." Removed — the icon already appears at its natural size in the
tab bar itself, so the section didn't need a second, larger copy of the same
glyph competing for the same vertical space as the actual content.

## Correction (post-ship): `filter_interval_entity` is unit-aware

**Origin**: owner-supplied entity data from Developer Tools for their own
interval helper — `min: 1, max: 12, step: 1, unit_of_measurement: months,
friendly_name: "Thermostat Furnace Filter Reminder Interval"` — with the
diagnosis "i think youre interpreting the entity as days instead of months."
Correct: `resolveInterval` originally read every `filter_interval_entity`
reading as a raw day count, matching `filter_interval_days`'s own unit but
with no way to tell that a *different* interval helper reports months (or
weeks) instead — a real, common shape for a "how often" `number` helper,
which naturally bounds itself to a small human range (1–12) in whatever unit
reads best, not raw days.

`intervalUnitFromEntity` now reads the entity's own `unit_of_measurement`
attribute (`month(s)`/`mo`/`mo.`/`mos`, `week(s)`/`wk`/`wks`, case-insensitive
substring/exact match; anything else — including unset — still defaults to
days, so `filter_interval_days` and every pre-existing days-unit entity are
unaffected). Rather than approximating months as a fixed 30-day multiple
(which would drift by a day or two depending on which calendar months are
spanned), `addInterval` adds months via `Date.setMonth`, calendar-correct;
`FurnaceFilterModel.intervalDays` is now *derived* from the resulting
`dueDate` (`daysBetween(lastChangedStart, dueDate)`) rather than being the
source the due date is computed from — the field stays an honest day count
regardless of which unit the underlying entity actually reports in.
