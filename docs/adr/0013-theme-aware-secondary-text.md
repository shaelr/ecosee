# Theme-aware secondary text

**Status: Accepted.** Origin: owner report ("all other text can we make it follow
the theme colors?" — clarified, on request, to mean Home Assistant's own theme:
"you can actually change all the font color then... keep the amber/blue heat/cool
badge. change all the other text to follow the home assistant theme").

## Context

Every text color in the Skin was a fixed literal (`--ecosee-accent` cyan,
`--ecosee-fg` off-white, `--ecosee-muted` gray) — deliberately, per the Skin's own
definition (CONTEXT.md: "the pixel-perfect ecobee Premium visual layer... _Avoid_:
theme, style, template"). That stance is still right for the elements that carry
actual device meaning: the big current-temperature number's gradient, the amber
Heat / blue Cool setpoint badges (and the Temperature Adjust bubble/gradient that
belongs to that same family), the top-row affordance icons (white on the real
device — issue #37), and the Standby Screen's white-on-black idle display. None of
those are "text" in the sense the request meant; they are the ecobee's own visual
vocabulary and stay fixed regardless of dashboard theme.

Everything else — overlay titles, hints, labels, readings, the humidity line, the
Resume Schedule pill, the tab bar's temperature badge — is generic UI copy with no
device-specific meaning attached to its *color* (only the badges and glow carry
that). Leaving it a fixed cyan/gray regardless of the user's own Home Assistant
theme was never a deliberate design position on that copy specifically; it was
just the Skin's default palette applied uniformly because there was no reason yet
to split "device vocabulary" text from "ordinary UI" text.

**The literal request is unsafe applied naively.** Home Assistant's
`--primary-text-color` / `--secondary-text-color` are calibrated to sit on the
*dashboard's own* background (`--card-background-color` et al.) — in a light theme
that's a dark, near-black color, meant for a light surface. This Skin's canvas is a
fixed near-black by default (config `background_color`, else tokens.ts's
`--ecosee-bg`) **regardless of the dashboard's theme** — it doesn't lighten just
because the user is on a light HA theme. Wiring text straight to
`--primary-text-color` would put a light theme's near-black text on this Skin's
near-black canvas: unreadable, for every light-theme user, on every text element
touched.

## Decision

- **Split fixed roles from theme-following roles.** The four elements above (big
  number, Heat/Cool badges + Temperature Adjust bubble, top-row icons, Standby
  Screen) keep the Skin's fixed colors untouched — the "keep the amber/blue
  heat/cool badge" carve-out in the request, extended to the other elements that
  carry the same kind of device-fidelity meaning rather than being ordinary copy.
  Every other `color:` declaration that sets literal text (not a border, fill,
  outline, divider, or standalone icon glyph — those stay the Skin's fixed accent,
  see Consequences) now reads one of three new tokens instead of the old
  `--ecosee-accent` / `--ecosee-fg` / `--ecosee-muted`.
- **Contrast-gated adoption, not a blind swap.** `<ecosee-card>` reads the
  dashboard's `--primary-text-color` / `--secondary-text-color` and only adopts
  each as an inline override when it clears WCAG **AAA** (7:1, not AA's 4.5:1)
  against the canvas color actually in play (`styles/theme-contrast.ts`,
  `styles/resolve-css-color.ts` — the latter resolves an arbitrary CSS color string
  by letting the browser parse it via a detached probe element's computed style,
  rather than hand-rolling a parser for hex/`rgb()`/`hsl()`/named colors). AAA, not
  AA: a mid-gray `--secondary-text-color` that cleared AA by a comfortable margin
  still read as genuinely hard to read in practice (owner report with a
  screenshot, on the Weather Overlay's "Overnight / Morning / Afternoon" period
  labels and its "as of" subtitle) — this Skin's type is thin (weight 300-400
  throughout, sometimes lighter), which needs more contrast than AA's normal-weight
  assumption to read comfortably at the same ratio. A theme color that doesn't
  clear AAA is silently rejected — the Skin's own fixed color wins, exactly as if
  no theme variable were present at all. `background_color: 'transparent'` skips
  the check outright: there's nothing of the Skin's own left to contrast against,
  so whatever the theme color is calibrated for (the dashboard's own surface) is
  what's actually behind the card.
- **Two "primary text" tokens, not one, so no dashboard's default appearance
  changes.** `--ecosee-text` (fallback: the old `--ecosee-fg` off-white) and
  `--ecosee-text-accent` (fallback: the old `--ecosee-accent` cyan) both receive
  the *same* resolved theme color when one qualifies — they exist as two tokens
  purely so each call site's *fallback*, when no theme color qualifies, reproduces
  its own previous fixed color exactly. Collapsing every text color to one shared
  fallback would have recolored roughly half the Skin (everything that used to be
  cyan) even for a dashboard that never sets a theme variable at all, or whose
  theme color fails the contrast check — a visible regression unrelated to
  theming.

## Consequences

- Borders, fills, outlines, dividers, and standalone icon glyphs (the ✕ close
  button, the top-row weather/mode/menu icons, the Fan screen's dropdown caret, the
  Weather pager's chevrons, a sensor card's icon) are **not** touched — they keep
  reading the plain `--ecosee-accent` / `--ecosee-muted` tokens, unchanged. This
  keeps pill outlines and "selected" chip fills a reliably saturated color that
  `--ecosee-chip-ink`'s fixed near-black punch-through text was designed against;
  wiring a fill to a theme text color could — in a light theme — collapse fill and
  chip-ink to the same near-black and make the selected state unreadable. Where a
  single element mixes a text label with an inherited (`currentColor`) icon in the
  same control (`.tab.temp`'s numeral + ring is one exception with genuinely
  separate declarations; a Comfort Setting row's glyph next to its label is not),
  the icon rides along with the text change rather than being split out — treated
  as one readable unit, not a targeted exemption.
- `styles/theme-contrast.ts` is pure (WCAG relative luminance / contrast ratio,
  fully unit-tested against fabricated RGB triples and a fake color resolver);
  `styles/resolve-css-color.ts` is the DOM-dependent glue (a real browser's own
  color parsing via a detached probe element), deliberately excluded from unit
  tests the same way `font-probe.ts` splits `createCanvasMeasure` (DOM-dependent)
  from `isDegenerate` / `filterDegenerateFamilies` (pure, unit-tested) — verified
  instead by direct visual check (Playwright against the dev harness with
  `--primary-text-color` stubbed to a legible dark-theme gray, an illegible
  light-theme near-black, and unset).
- `<ecosee-card>._syncThemeText()` mirrors `_syncDeviceScale()`'s existing
  `getComputedStyle` + `_setOrClear` shape: re-run on `firstUpdated` (so it can see
  the dashboard's inherited theme variables even when `setConfig` lands
  pre-connect) and whenever `_config` changes (`background_color` is the canvas
  the check runs against).
- This is a narrow, deliberate exception to the Skin's "_Avoid_: theme" naming
  guidance (CONTEXT.md) — the Skin itself is not becoming a theme, and the
  elements that carry the ecobee's own visual identity stay exactly as fixed as
  before. Only the copy that never carried device meaning in its color now also
  respects the one dashboard-level signal (light vs. dark, or a custom theme's
  text color) that was previously invisible to the Card.

## Correction: WCAG AAA, not AA

The initial implementation gated adoption on WCAG AA (4.5:1). A mid-gray
`--secondary-text-color` cleared that comfortably but still read as genuinely hard
to read in practice (owner report with a screenshot: the Weather Overlay's
"Overnight / Morning / Afternoon" period labels and its "as of" subtitle). This
Skin's type is thin (weight 300-400 throughout, sometimes lighter), which needs
more contrast than AA's normal-weight assumption to stay comfortable at the same
ratio. `MIN_TEXT_CONTRAST` (`styles/theme-contrast.ts`) is now 7 (WCAG AAA).

## Correction: muted/secondary text mirrors primary text, not `--secondary-text-color`

Raising the bar to AAA still didn't fully resolve the report: once the owner could
compare the two side by side, the request sharpened to "the text is clearly white,
but the subtext I would call it gray" — a real Home Assistant theme's own
`--secondary-text-color` reliably reads as visibly dimmer next to its
`--primary-text-color`, by design (that's the whole point of the pairing on a
normal dashboard). This Skin's readable copy — hints, captions, "as of"
subtitles — never had that hierarchy in mind: `--ecosee-muted` and
`--ecosee-accent` were simply two different fixed literals with no more meaning
than "what the original design happened to use where," not a deliberate
primary/secondary reading order.

`--ecosee-text-muted` (tokens.ts) now reads `var(--ecosee-text)` instead of its
own fixed literal, and `<ecosee-card>._syncThemeText()` no longer probes
`--secondary-text-color` at all — there is exactly one adopted theme color
(`--primary-text-color`), and every text role that isn't one of the fixed/device
exceptions renders it identically. `--ecosee-muted` itself (the non-text token —
borders, dividers, standalone icon glyphs) is untouched; the "subtext" complaint
was specifically about *readable copy* looking dimmer than its neighbor, not about
chrome wanting more visual weight.

## Correction: thin (≤300 weight) numerals stay fixed, not theme-following

Even after both corrections above, the owner reported specific elements still
looked grey: the Home Screen's humidity reading, and the Weather Overlay's current/
forecast temperature numerals. Comparing against elements confirmed to look right
("the text is clearly white") isolated the actual variable — not the color, but the
**font weight**. This Skin renders numeral readouts thin (weight 200-300) by
design, following the device (`.temp`, the dominant current-temperature number,
was already fixed for exactly this reason, being weight 200). At that weight, thin
strokes against the near-black canvas visibly desaturate even a technically-AAA
theme color — the same literal `--primary-text-color` value read crisp and white
on a weight-600 heading and dim/grey on a weight-300 numeral beside it. This is a
real rendering effect (anti-aliased thin strokes carry proportionally more blended-
with-background pixels than thick ones), not a contrast-math shortfall — no
threshold this side of AAA fixes it, because the WCAG contrast formula does not
account for stroke weight at all.

The fix extends the "kept fixed" exception list (originally just the four elements
in Context) to every weight-≤300 numeral readout, treating them the same as the
Skin's other thin numerals rather than trying to find a contrast bar thin type can
clear: `.hum` and `.unavailable` (Home Screen), `.neighbor` (Temperature Adjust's
scrubber), and `.current-temp` / `.period-temp` / `.day-high` (Weather Overlay).
Each reverted to its original fixed `--ecosee-accent` / `--ecosee-muted` token.
Every remaining theme-following text element is weight ≥400 (headings, labels,
hints, mode/preset names, sensor readings, captions) and was individually checked
against this file's own font-weight declarations before being left alone — not
assumed safe by category.

## Correction: the cyan-accent readouts go white, not back to cyan

The previous correction's fallback — reverting to the original fixed
`--ecosee-accent` — was itself rejected on sight ("i dont want them cyan i want
them white"): the cyan accent read flat at this thin weight too, same as the theme
color had. A new fixed token, `--ecosee-numeral` (white), replaces
`--ecosee-accent` on the four readouts that were on it: `.hum` (Home Screen),
`.current-temp` / `.period-temp` / `.day-high` (Weather Overlay). It deliberately
does **not** extend to `.neighbor` / `.unavailable`, which were already
`--ecosee-muted` (a grey-blue, not cyan) and were never the subject of this
complaint, nor to `.temp` (the dominant current-temperature number), which keeps
its own cyan gradient as the Skin's signature look rather than a plain readout.
