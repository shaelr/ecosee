# Home Screen sensor row

**Status: Accepted.** Origin: owner request — "on the main display can we add
an option to show the main temperature and the sensors underneath it in
smaller format?", refined to "i want the option of which to show on the main
card."

## Context

The physical Premium shows only the thermostat's own reading on its face;
remote sensors live one tap away on the Sensors screen. The owner wanted
selected rooms visible at a glance without leaving the Home Screen. This is a
Card addition, not device fidelity (like the fan affordance).

## Decision

- **Per-sensor opt-in, no master switch.** Each `sensors[]` item takes an
  optional `show_on_home: true`; the visual editor shows a "Show on Home
  Screen" checkbox per sensor. Only `true` is ever written — unticking drops
  the key and collapses the item back to its shorthand string when nothing
  else is set. No flagged sensors means no row and a pixel-identical Home
  Screen.
- **The thermostat's own reading is excluded** — it is already the big number.
  `toHomeSensors` (src/sensors/sensors.ts) reads only the configured list, in
  config order, dropping degraded sensors exactly as the Sensors screen does.
  It is passed to the Home Screen as its own `.sensors` property rather than
  added to `HomeView`, because sensors.ts already imports from home-view.ts.
- **Placement: directly beneath the big number**, above the setpoint ovals /
  range pill.
- **Stacked chips (reading over name) in fixed 21cqw columns**, four per row,
  wrapping to a second row, capped at eight. The in-chat sketch showed inline
  "Bedroom 70°"; stacked chips were chosen during implementation because a
  fixed column width keeps four per row predictable regardless of name length
  (long names ellipsize). Readings use the thin `--ecosee-numeral` white;
  names use the theme-aware muted text (ADR-0013).
- **The big number shrinks to make room** — 33cqw with one row, 23cqw with
  two — so the tallest combination (two sensor rows + the range pill with
  "until" + both foot gauges) still fits the canvas. The two-row size was
  set by screenshot in Firefox and Chromium, not DOM measurement alone
  (ADR-0014's lesson): 27cqw measured as fitting in Chromium but clipped the
  gauge labels in Firefox.
- **Tap opens Home Assistant's more-info dialog** (`hass-more-info`, bubbling
  and composed) for that sensor — its history — rather than an ecosee Overlay.

## Consequences

- With sensors flagged, the Home Screen trades some of the big number's size
  for density; owners who prefer the device's look simply flag none.
- Sensor reordering (a separate, still-open request) will reorder this row
  too, since it follows config order.
