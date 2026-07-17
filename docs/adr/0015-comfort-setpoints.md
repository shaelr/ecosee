# Comfort Setpoints

**Status: Accepted.** Origin: owner request, the second half of the request that
started ADR-0014: "the ha-ecobee also includes scheduling abilities to change
what time the comfort settings change, as well as changing comfort setting set
points. can we incorporate that into the card as well?" — Schedule shipped
first (ADR-0014); this ADR covers the deferred second half.

## Context

ADR-0014's own Context section already identified this as a separate,
independently-shipped `ha-ecobee` capability: `EcobeeComfortTemp` (`number.py`)
— a `number` entity pair (Heat Temp / Cool Temp) for **every** comfort setting
on the thermostat's program, including custom ones, keyed by `climateRef` +
field (`heatTemp`/`coolTemp`). This is a config-only value distinct from the
climate entity's own *live hold* target that the Temperature Adjust overlay
edits (`temperature-adjust.ts`) — changing a Comfort Setting's Heat Temp
doesn't touch whatever the thermostat is holding right now; it changes what
that Comfort Setting sets the thermostat to the next time it becomes active
(a schedule block, a manual preset pick, or Resume Schedule).

### Why explicit per-preset config, not auto-derived entity ids

A `number` entity's `entity_id` is generated from its friendly name (`"{Comfort
Setting name} {Heat/Cool} Temp"`) via Home Assistant's own slugify + collision
suffixing, and is user-renameable independent of that name — there is no
reliable way to derive `number.home_heat_temp` from `preset_mode: "Home"` and a
climate entity id alone. `config.ts` already has exactly this shape for
"curated, explicitly-listed extras" in `sensors` (issue #9); `comfort_setpoints`
follows the same pattern: a list of `{ preset, heat_entity?, cool_entity? }`
rows, keyed by the Comfort Setting's own name (the same string
`preset_mode`/`preset_modes` carry) rather than by index or entity id, so
`comfort-setpoint.ts` can reuse `comfort-setting.ts`'s existing icon/label
resolution (`comfortIconFor`, `comfortLabelFor`, newly exported) directly — the
same reasoning ADR-0014 used for keying Schedule blocks off the comfort
setting's plain name.

### Why a new Main Menu section, not an extension of the Comfort Setting picker

Scoped with the owner via two questions: where setpoint editing should be
reached from, and what control should adjust a value. The owner chose a **new
Main Menu section** (`setpoints`) over adding an edit affordance to the
existing Comfort Setting picker's rows — keeping "pick the active Comfort
Setting" (`comfort-setting.ts`, a single discrete write) and "edit a Comfort
Setting's own targets" (a multi-field, multi-entity surface) as two separate
screens rather than overloading one row's tap target with two different
actions. This also sidesteps a layout problem the picker-row approach would
have hit: a Comfort Setting's row would need to show a select action *and* two
independent edit affordances (Heat, Cool) in the same compact row.

For the edit control itself, the owner asked for "the pills that open another
temperature selection similar to the main override selection" — i.e., each
Heat/Cool value renders as a small pill (matching the pill language already
used elsewhere — Schedule's Add Block fields, the Temperature Adjust overlay's
own setpoint chips), and tapping one pushes a picker visually and
interactively modeled on the Temperature Adjust overlay's own scrubber (a
vertical drag + ± nudge, a gradient bubble showing the value with dimmer
neighbors above/below) — not a plain numeric text input.

### Why the picker is a new, simpler component, not a direct reuse of the Temperature Adjust overlay

`temperature-overlay.ts`/`temperature-adjust.ts` are built specifically around
editing the **live hold**: two chip-switchable setpoints with cross-field
deadband-push logic (`withValue` pushes the paired setpoint to hold
`min_gap`), and an optimistic-hold/reconcile dance against `hass` updates that
matters because the climate entity keeps polling and could otherwise yank the
scrubber out from under an in-progress edit. None of that applies here:

- Each Comfort Setpoint field is an **independent** `number` entity — there is
  no cross-field gap to enforce client-side, because `EcobeeComfortTemp`'s own
  `set_native_value` already calls `enforce_heat_cool_min_delta` server-side
  when either field is set (confirmed against `ha-ecobee`'s `number.py`).
  Duplicating that clamp here would be redundant, second-guessing logic that
  could disagree with what the server actually enforces.
- There is only ever one target on screen (the pill tapped chose it), so there
  is nothing to chip-switch between.
- The picker seeds its edit state once on connect (mirroring
  `schedule-add-block-overlay.ts`'s one-time seed, not
  `temperature-overlay.ts`'s `willUpdate` re-seed guard) — simpler because
  there is no cross-field push to protect against once a later `hass` update
  is never re-read into local state at all.

`comfort-setpoint.ts` still reuses `temperature-adjust.ts`'s `SetpointEdit`
type, its now-exported `snapClamp`, and its `scrubberWindow` directly — a
single Comfort Setpoint field *is* exactly a `SetpointEdit` (a clamped, stepped
value with bounds), just sourced from a `number` entity's own
`min`/`max`/`step` capability attributes (confirmed against HA core's
`number/const.py`: `ATTR_MIN`/`ATTR_MAX`/`ATTR_STEP` = `"min"`/`"max"`/`"step"`)
instead of a climate entity's `min_temp`/`max_temp` and a unit-derived step.
The debounced-write behavior (`WRITE_DEBOUNCE_MS`) is kept, though, since these
are still ecobee cloud-backed `number` entities and carry the same
rate-limit/revert risk a burst of un-coalesced writes hit on the live hold.

### The write path

`number.set_value` **is** an ordinary Home Assistant service (confirmed
against `homeassistant/components/number/__init__.py`:
`platform.async_register_entity_service(SERVICE_SET_VALUE, ...)`), unlike
Schedule's `update_event` (ADR-0014, websocket-only). `setNumberValueCall`
builds it, and the picker emits it through the Card's existing unified
`ecosee-service-call` event — no new host-side write path was needed, unlike
Schedule's `_sendScheduleUpdate`.

## Decision

- **New config key**: `comfort_setpoints` (a list of
  `{ preset, heat_entity?, cool_entity? }`). At least one of `heat_entity`/
  `cool_entity` is required per row (an empty row has nothing to show);
  either alone is legal (e.g. a cooling-only system's presets never need a
  Heat entity).
- **New Main Menu section**, `setpoints`, added to `TAB_SECTIONS` alongside
  System/Sensors/Fan/Schedule — reachable via the tab bar, hidden when no row
  resolves a usable field (ADR-0001). A new tab glyph (`icons.setpoints`, two
  slider tracks with handles) since none of the existing icons represented
  "adjustable value" — the closest candidates (`thermostat`, the Comfort
  Setting glyphs) are already spoken for by other surfaces.
- **`src/climate/comfort-setpoint.ts`** is the seam, the same shape as every
  other: `toComfortSetpointsModel(hass, config)` resolves each configured row
  independently per field (a field with a missing/unavailable/non-numeric
  entity is dropped, not the whole row — ADR-0001), `setNumberValueCall`
  builds the write, and `nudgeSetpoint`/`scrubSetpoint` are thin wrappers
  around the reused `snapClamp`.
- **Two new Overlays**: `comfort-setpoints-overlay.ts` (the hub — a scrollable
  card list mirroring `sensors-overlay.ts`'s own list/card layout, one card
  per configured Comfort Setting with up to two value pills) and
  `comfort-setpoint-overlay.ts` (the picker — the simplified single-value
  scrubber described above), wired through the Card's standard
  hub-and-picker `_overlays` table/nav-stack machinery exactly like Schedule's
  `schedule` → `schedule-start-time`.

## Consequences

- `comfort-setting.ts` gained a second exported lookup, `comfortLabelFor`
  (mirroring the already-exported `comfortIconFor`), so both the Comfort
  Setting picker and the Comfort Setpoints hub resolve a Comfort Setting's
  display label identically without duplicating the Home/Away/Sleep table.
- `temperature-adjust.ts`'s `snapClamp` is now exported — the only change to
  that module. Its cross-field push logic (`withValue`, `nudge`, `scrub`,
  `setValue`) stays private to the live-hold use case; Comfort Setpoints
  never imports them, only the bound-and-step primitive and the
  already-exported `scrubberWindow`.
- A Comfort Setting present in `comfort_setpoints` but not currently one of
  the bound entity's actual `preset_modes` (a stale/typo'd config, or a
  Comfort Setting deleted on the thermostat since) still renders normally —
  the two lists are read independently (ADR-0001) — it just falls back to the
  default Comfort Setting glyph rather than a mismatch or error.

## Extension: comfort_setpoints as a Comfort Setting picker allowlist

**Origin**: owner report ("the comfort settings in the menu should adhere to
the set comfort settings in the card config. that way it only displays the
comfort settings i want").

`toComfortSettingModel` (`comfort-setting.ts`) previously listed every preset
the bound entity's own `preset_modes` reported, with no way to hide one a
user doesn't actually use (e.g. a stale custom preset, or a name the
thermostat exposes but the household never picks). Since `comfort_setpoints`
already represents "the Comfort Settings I've deliberately set up in ecosee,"
it now doubles as an allowlist for this picker too: when configured, only the
presets it names are offered, in the entity's own order (not the config
list's order — the config is a filter, not a reordering); when unset or
empty, every entity-reported preset stays available, unchanged from before
this existed (ADR-0001: an unset optional key never narrows behavior).
Matched case-insensitively, mirroring `comfortIconFor`/`comfortLabelFor`'s
own lookup and the same casing gotcha ADR-0012's "Correction" already hit
(ecobee's own preset naming doesn't always match how a user typed a name in
YAML).

Because `toComfortSettingModel` is a shared seam — the System sub-screen's
Comfort Setting selector, the actual Comfort Setting picker
(`comfort-setting-overlay.ts`) it opens, and the Schedule Add Block screen's
own Comfort Setting dropdown (`schedule-add-block-overlay.ts`) all call it —
the allowlist applies to all three consistently, not just the one screen the
owner named. This is deliberate, not an accidental side effect: the same
"comfort settings I want" curation the owner asked for one picker to respect
would otherwise leave Schedule's Add Block screen still offering the
un-curated full list, an inconsistency between two pickers backed by the
identical model.
