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
  theming. `--ecosee-text-muted` (fallback: the old `--ecosee-muted` gray) is the
  analogous single token for secondary/muted copy, since every prior muted-text
  call site already shared the same fallback.

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
