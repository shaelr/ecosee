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

## Correction (post-ship): the last-changed date and interval are editable in place

**Origin**: owner correction — "i think you mis interpreted what i wanted on
the filter menu page. you should be able to set the date last changed
manually, as well as set the interval timing (from the entity)." The section
as originally shipped only ever *displayed* the last-changed date and the
computed due date; the only write path was the "I've changed my filter"
button (always "today"). The owner wanted the last-changed date itself
settable to an arbitrary date, and the interval settable directly, without
leaving the section.

### Interaction: a tappable pill, native picker underneath

Neither this codebase nor Home Assistant's own frontend gives the Card a
calendar-grid or number-scrubber component to compose (the editor's
`ha-form` selectors are a *config-time* GUI, not something the Card's own
runtime can mount) — and building one from scratch would be a large, risky
addition for what is, realistically, an occasional correction rather than a
frequent interaction. `fan-overlay.ts`'s minimum-runtime dropdown had
already solved the equivalent problem for a `<select>`: a styled, static
label sits on top for the visual, and a fully transparent *real* native
control (`.select-native`) is layered exactly over it, `pointer-events: auto`,
capturing the tap and opening the platform's own picker UI. The Furnace
Filter section reuses the identical trick for two more native input types:
`<input type="date">` for the last-changed pill and `<input type="number">`
(bounded to the entity's own `min`/`max`/`step`) for the interval pill — free
native picker UI, zero new picker components, and a `@change` handler that
builds and emits the same `ServiceCall` shape every other editing Overlay
already uses.

### Two independent editability gates, not one

- **Last changed** (`FurnaceFilterModel.canEditLastChanged`): true only when
  `filter_last_changed_entity`'s own domain is directly writable
  (`input_datetime`/`date`/`datetime` — `WRITABLE_DATE_DOMAINS`, reused from
  `markFilterChangedCall`'s own gate). Deliberately narrower than the
  existing `canMarkChanged` (which also considers `filter_reset_entity`) —
  a reset entity is an opaque `button`/`script` trigger with no parameter
  slot for "set it to *this* date," it can only ever mean "now." A
  read-only `sensor` computed elsewhere therefore keeps the "I've changed my
  filter" button (via the reset entity) but the date itself renders as plain
  text, not a pill — there is nothing this Card can write an arbitrary date
  onto.
- **Interval** (`FurnaceFilterModel.intervalEdit`, `null` when absent): only
  present when `filter_interval_entity` is configured and currently resolves
  to a numeric reading. A static `filter_interval_days` has no entity behind
  it to write to, so it stays exactly what it was — a number baked into the
  Card's config, not something the Card can edit at runtime — and the
  Interval row doesn't render at all in that case (no pill promising an edit
  that can't happen).

`FilterIntervalEdit` intentionally carries the interval in the entity's own
native unit/value (e.g. `{ value: 3, unit: 'months' }`), not the
already-day-converted `intervalDays` — editing "3 months" should read and
write "3," not a derived ~90. The write reuses `comfort-setpoint.ts`'s
already-exported `setNumberValueCall` verbatim (the exact same
`number.set_value` call Comfort Setpoints itself uses) rather than
duplicating a second copy of that one-line call builder.

### Fitting the extra row

Two more potentially-shown rows (Last Changed's pill, a new Interval row)
on top of an already-tight canvas (the prior "icon removed" correction above
was itself a fit fix) meant re-checking the worst case: last-changed pill +
interval pill + "Was due" + "Overdue by N days" + button, five rows deep.
Verified via the `dev/` harness at the fixed base size with the owner's own
real entity shape (`min: 1, max: 12, unit_of_measurement: "months"`) — it
fits with room to spare after the icon-removal correction freed enough
vertical budget; `.content`'s gap/margin were trimmed further regardless
(6u→5u gap, 4.5u→3u top margin, row font-size 5.2cqw→4.8cqw) to keep a
comfortable cushion above the tab bar rather than running it right to the
edge.

## Correction (post-ship): the pills didn't actually respond to a tap

**Origin**: owner report on a real device — tapping either pill did nothing,
and focusing one drew a visible double ring instead of a single thicker one.

**Double ring**: `.pill:focus-within`'s `outline-offset: 0.6cqw` pushed the
focus outline outside the pill's own border with a visible gap between them
— two concentric rings rather than one thicker line. Removed the offset
(defaults to `0`, flush against the border).

**Dead tap**: `.pill-native` used `opacity: 0` to stay invisible, the same
trick `fan-overlay.ts`'s `.select-native` runtime dropdown already uses
successfully — but a native `<input type="date">`/`<input type="number">`
isn't a `<select>`, and mobile WebKit in particular is documented to treat a
near-zero-opacity date/number input as invisible enough that it won't open
its own picker/keyboard on tap, even though the element still receives
focus. Switched to `background: transparent; color: transparent;` (invisible
by having nothing to paint, not by an opacity multiplier) plus explicit
`outline: none` (the native focus ring would otherwise become visible again
now that opacity isn't hiding it) and
`::-webkit-calendar-picker-indicator { background: transparent; }` (the
date input's own calendar-icon affordance, which `color`/`background` on the
host element don't reach).

One residual, accepted gap: a date input's actively-edited segment
(month/day/year) renders its own highlighted "selected" box using the
browser's internal UA styling for that state — not the standard
`::selection` pseudo-element (tried; had no effect), and not something
public CSS can suppress. It only shows during direct keyboard/segment
editing (Tab-focus + typing), not the primary tap-to-open-the-picker flow,
and browsers deliberately don't expose a way to fully hide it — the same
security reasoning that made `opacity: 0` risky in the first place also
rules out making a date input's active-editing state fully invisible.
Verification of the tap-opens-the-real-picker behavior itself was also
necessarily limited: headless Chromium (this project's only available
browser automation target) doesn't render native OS-level picker overlays
at all, so the fix here is grounded in documented cross-browser behavior
rather than a captured screenshot of the picker actually opening.

## Correction (post-ship): Interval is a dropdown menu, not a number field; the date pill always opens the calendar

**Origin**: two owner follow-ups after confirming the previous correction's
mobile fix worked ("the date last changed works great on the mobile,
touching the pill opens the calendar"): "can the interval be a menu style
like the fan duration" and "on a computer clicking the pill allows you to
type the date in ... i want it to always open the calendar."

### Interval → a `<select>` dropdown, mirroring `fan.ts`'s own runtime selector

The interval pill's `<input type="number">` is replaced with a native
`<select>` populated from the entity's own `min`/`max`/`step` — the exact
shape `fan.ts`'s `MinRuntimeModel`/`runtimeOptions` already builds for the
Fan screen's minimum-runtime selector, copied here as
`FilterIntervalEdit.options`/`intervalOptions` rather than generalized into
a shared helper (the two are close enough in shape but different enough in
context — a `MinRuntimeOption`'s value is always minutes, an
`IntervalOption`'s label runs through `formatIntervalUnit`'s three-way
day/week/month pluralization — that sharing one generic function would cost
more in indirection than the ~15 lines it would save). `FilterIntervalEdit`
dropped its old `min`/`max`/`step` fields (no longer needed once the overlay
renders a `<select>`, not a bounded `<input>`) in favor of `options:
IntervalOption[]`; the current value is always included even if it falls off
the entity's own step grid (mirrors `runtimeOptions`'s identical guarantee),
so the selector never hides the active setting. The overlay's `.select-native`
reuses `fan-overlay.ts`'s own `opacity: 0` hiding trick rather than the
`.pill-native` transparent-color workaround above — a `<select>` isn't
subject to the same WebKit invisible-date/number-input heuristic, confirmed
by the Fan screen's own runtime dropdown having shipped opacity-hidden
without incident.

### Last changed → `showPicker()` forces the calendar open on every tap

Chrome's default click behavior on a **visible** `<input type="date">`
depends on exactly where within the box the click lands: the calendar-icon
region opens the picker, elsewhere in the box just focuses a segment for
keyboard typing. Our invisible input covers the *entire* pill, so a tap
essentially never lands on the (hidden) icon's own hit-region — on desktop,
where mouse clicks are precise, this reliably lands in "type the date"
segment-edit mode instead of opening the calendar; on mobile, apparently
different tap-handling made this materialize as "the calendar opens" per
the owner's own confirmation, so the inconsistency is desktop/mobile input
handling, not the earlier opacity fix. `HTMLInputElement.prototype.showPicker()`
(Baseline 2023 — Chrome/Edge 99+, Safari 16.4+, Firefox 101+) sidesteps this
ambiguity entirely: called explicitly from the pill's `@click` handler, it
opens the calendar picker unconditionally, regardless of where in the box
the tap landed. Feature-detected (`typeof input.showPicker === 'function'`)
and wrapped in `try`/`catch` (the spec allows it to throw when rate-limited
or called outside a genuine user gesture) — either way, an unsupported or
throwing engine just falls back to the input's own default click behavior,
same as before this correction. Keyboard-only Tab-focus (no click) never
calls `showPicker()`, so accessible keyboard-driven typing into the date
segments is untouched.

## Correction (post-ship): cover the date input, don't try to color it away

**Origin**: owner report, with a screenshot of the calendar picker actually
open (confirming `showPicker()` above works) — but showing the native input's
own value rendered in full system styling, a segment highlighted, laid
directly over the pill's own cyan-outlined look.

The original approach tried to make `.pill-native` invisible entirely via
`color: transparent`, `::selection` overrides, and the `::-webkit-datetime-edit-*`
sub-part selectors (all still in place). None of it holds once the picker is
actually open: Chrome renders a focused date input's own value at full
system styling specifically while its native picker UI is active, and this
override reaches past `color` (confirmed — the segment highlight and, worse,
the full value text both painted through). A `-webkit-text-fill-color:
transparent` attempt (the mechanism behind autofill's forced text color
ignoring page CSS) didn't resolve it either. This reads as deliberate browser
behavior — keep the value legible while its own native UI is showing,
overriding the page's styling — not a gap in this file's CSS coverage.

Rather than continuing to fight the input's own rendering with more color
properties, `.pill-backing` physically covers it: a dedicated, purely
decorative sibling (`position: absolute; inset: 0`, matching `.pill-native`'s
own footprint exactly) painted between the input and the label in stacking
order, with an opaque `--ecosee-bg` background and `pointer-events: none` (so
taps still reach `.pill-native` beneath it). This doesn't depend on any CSS
property the input's own value-rendering might override — it's ordinary
paint-order stacking, which nothing about "keep the native UI legible" changes.

The one real constraint this ran into: `.pill-label` is the pill's *only*
in-flow child once `.pill-native` is taken out of flow via `position:
absolute` — `.pill`'s own `inline-flex` width is measured from it. Giving
`.pill-label` `position: absolute` too (to get the same full-pill coverage
directly on the label, without a separate element) removed it from flow as
well, leaving `.pill` with nothing to size itself against — it collapsed to
its padding alone, caught immediately by screenshot before shipping.
`.pill-backing` carries no content of its own, so it can be absolutely
positioned freely; `.pill-label` stays in normal flow, still sized from its
own text, just lifted above `.pill-backing` (`z-index: 2` vs `1`) so it
still reads on top.

## Correction (post-ship): a real `<button>`, not a covered `<input>`

**Origin**: `.pill-backing` didn't hold either — a further owner screenshot,
taken *after* that fix shipped, still showed a highlighted date segment
rendered over the pill. The owner's own diagnosis cut straight to it: *"cant
we just make it so its not a text box? and just a clickable button that
opens the calendar?"*

Every attempt up to this point shared one premise: keep `<input
type="date">` as the thing the user actually taps, and make it *look*
invisible (transparent color, an opaque covering sibling, whatever). That
premise was the bug. Chrome renders a *focused* date input's own value —
and, worse, an active-segment highlight — at full system styling while its
native picker UI is open, a "stay legible while showing" behavior that
turned out to reach past `color`, `::selection`,
`::-webkit-datetime-edit-*`, and even a higher-stacked opaque sibling in
normal page paint order. No further CSS property was going to out-stubborn
that; it reads as intentional, not a gap.

The fix drops the premise instead of the fight: `.pill-button` is an
ordinary, fully opaque `<button>` — never a form control, so there is
nothing for Chrome to ever decide to render natively over it. The actual
`<input type="date">` (`.date-native`) still exists, but only as a trigger:
genuinely tiny (`1px × 1px`) and `opacity: 0` — safe now, unlike
`.pill-native` before it, because nothing about it is ever the direct tap
target a raw touch/click needs to land on (the earlier "invisible inputs
can suppress the native picker on tap" finding was specifically about that
reliance, which a JS-invoked `showPicker()` doesn't have) — `tabindex="-1"`
and `aria-hidden="true"` (the button is what keyboard/screen-reader users
reach), and only ever focused programmatically, from `.pill-button`'s own
click handler calling `input.showPicker()` directly.

Confirmed working in the dev harness: the pill's own text stays exactly our
own styling at every stage, click through picker-open, with no highlight or
native text visible anywhere on it.

A secondary, *not yet fixed*, rough edge surfaced during that same testing:
the calendar popup itself doesn't anchor next to the pill the way it would
on an unscaled page — it opens near the top of the viewport instead. Not a
sizing issue (tried both the 1px input and a full-pill-sized one, no
difference) — it points at the whole Card's fixed-canvas
`transform: scale(...)` (every screen's own architecture, not specific to
this pill) confusing the browser's popup-anchor calculation. A
`position: fixed` input wouldn't escape it either, since a transformed
ancestor becomes the containing block for fixed descendants too. The actual
fix would render `.date-native` outside the transformed subtree entirely —
a portal to `document.body`, positioned via `getBoundingClientRect()` at
click time — deferred pending confirmation this reproduces on a real device
and not just headless Chromium testing, since it's a real jump in
complexity (a DOM node Lit doesn't own or reactively re-render) for what
may end up being a headless-testing-only artifact.

## Correction (real-device testing): reverted to a direct-tap input — iOS doesn't implement showPicker() for date/time

**Origin**: real iOS device testing (the Home Assistant iOS app's embedded
WKWebView) reported the Last Changed date field's calendar not opening at
all on tap — not mispositioned, as the popup-anchoring rough edge above
would suggest, but entirely non-functional. The same architecture applied
to Schedule's Start/End time fields (`schedule-add-block-overlay.ts`) and
the Start Time picker (`schedule-start-time-overlay.ts`, ported to match
after the owner liked the style) showed the identical symptom, while every
field still using a directly-tappable native control (`.select-native`'s
Interval pill, the Fan screen's runtime dropdown, Add to Schedule's Comfort
Setting) opened fine.

**Root cause, confirmed via WebKit's own issue tracker**: `showPicker()` is
simply unimplemented for `date`/`time` inputs on iOS WebKit — WebKit bug
261703, open since 2023, per a WebKit engineer's own comment: "only the
file input's `showPicker()` works on iOS." The call doesn't throw (it's
spec-present, passes feature detection, and the `try`/`catch` this code
already had never fired) — it's a silent no-op. Separately, per the same
engineer, iOS's native picker sheet is tied to the input receiving *real
focus*, not to any particular API — which is exactly why the direct-tap
`.select-native`/Comfort Setting fields kept working: the tap lands on the
real control and focuses it directly, where the button+`showPicker()` split
routes the tap through a *different* element first.

**The fix**: dropped the button+hidden-input split and went back to a
direct-tap native `<input type="date">`/`<input type="time">` — a
transparent `.pill-native` (or, for the Start/End and Start Time fields, a
plain `input` under the same `.pill`/`.field` markup) laid directly over the
visible label, `opacity: 0`, sized to the pill, exactly the `.select-native`
technique. This knowingly reintroduces the Chrome desktop bleed-through risk
the button was built to dodge (a focused date input's own value/highlight
showing through while its picker is open) — traded off deliberately, since
a control that's silently broken on every iPhone is worse than a possible
cosmetic regression on one desktop browser. Watch for that symptom (stray
native text/highlight in the Last Changed pill while the calendar is open)
returning on desktop Chrome; the popup-anchoring rough edge documented above
is now moot for the Start/End and Start Time fields (no calendar popup for a
`type="time"` input to mis-anchor) but remains open for Last Changed's date
picker.
