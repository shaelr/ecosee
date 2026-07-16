# Combined range pill on hold

**Status: Accepted.** Origin: owner report, a screenshot of the real ecobee's
home screen while on hold — a single "22 – 24 | until 23:00 ⓧ" pill in place of
the two separate setpoint ovals: "the actual ecobee does this when you have an
override, it changes the pills into this instead of the resume schedule
popup. can we do the same thing?"

**Narrows [ADR-0004](./0004-no-hold-or-resume-schedule.md)'s "no combined
range pill" consequence**, extending [ADR-0012](./0012-opt-in-resume-schedule.md)
the same way ADR-0012 itself narrowed ADR-0004's "no Resume" stance: not a
reversal of the default (a bare, non-opted-in Card still shows plain
setpoint ovals and nothing else), but a further behavior layered onto the
same opt-in, best-effort hold check ADR-0012 already computes.

## Context

Re-verified directly against `homeassistant/components/ecobee/climate.py`
(not assumed from the earlier ADRs) before starting: `extra_state_attributes`
still returns only `fan`, `climate_mode`, `equipment_running`,
`fan_min_on_time`, and the two sensor-participation lists. The raw hold
event's `startDate`/`endDate` are read internally (`preset_mode`'s own
`is_indefinite_hold` check) but never surfaced to Home Assistant. **The
hold-expiry time is still unavailable** — ADR-0003's finding stands
unchanged. Showing "until 23:00" would mean fabricating a value the Card has
no way to know, which is exactly what ADR-0001/0003/0004's shared philosophy
(never fake data HA doesn't expose) rules out.

The combined pill's *shape*, though, needs no new data at all: both
`setpoints.heat` and `setpoints.cool` are already read every render, and
whether to show the pill is already computed by ADR-0012's
`resumeAvailable` — the same best-effort `climate_mode !== preset_mode`
check that gated the old text pill. The only new judgment call was scope
— presented to the owner directly, since it revives a rejected design:

- **Where should this land**: extend the existing Comfort Setting picker row,
  or replace the ovals? — not asked; the reference screenshot was
  unambiguous (the device replaces its setpoint display outright, no
  separate control elsewhere).
- **What to do about the missing "until" text**: fabricate a plausible time,
  omit it silently, or confirm with the owner and ship a pill that's honest
  about what the Card can't know. Asked directly; the owner chose to proceed
  without it.

## Decision

- `HomeView.resumeAvailable` (unchanged, ADR-0012) now also decides *which*
  setpoint display renders, not just whether a second pill appears beneath
  it: `true` → the combined range pill; `false` → the setpoint ovals, exactly
  as before. The two are mutually exclusive — never shown together, unlike
  ADR-0012's original "pill beneath, ovals unchanged" shape.
- The combined pill (`.range` in `home-screen.ts`) shows each active
  setpoint in its own oval's color (amber Heat, blue Cool) separated by an
  en dash in Heat / Cool (Auto), or a single colored value with no dash in a
  single-setpoint mode — then a trailing circled ✕. Tapping a value opens
  Temperature Adjust for that setpoint, exactly like tapping its oval did;
  tapping the ✕ fires `ecobee.resume_program`, exactly like the old text
  pill did. No "until HH:MM" text anywhere on it.
- `HomeView.resumeReserved` and its dedicated layout-slot-reservation
  machinery (ADR-0012's second "Correction") are removed: that trick existed
  specifically to stop an *extra* row (the old text pill, sitting beneath an
  always-present oval row) from popping in and out and reflowing the
  cluster above it. With the pill now *replacing* the oval row in place —
  always exactly one setpoint-display row, ovals or range pill — there is no
  extra row to reserve space for, so the mechanism has nothing left to do.
  `resumeReserved()` stays exported from `climate/resume-schedule.ts` (still
  used internally by `resumeAvailable()`, still independently unit-tested)
  — only its threading onto the public `HomeView` shape is gone.

## Consequences

- Every `HomeView` test fixture across the suite that previously set
  `resumeReserved` had that key removed; the dedicated `resumeReserved`
  describe blocks in `home-view.test.ts` were removed as testing a field
  that no longer exists. `resume-schedule.test.ts`'s own tests of the pure
  `resumeReserved()` function are untouched — the function itself didn't
  change.
- `home-screen.test.ts`'s Resume Schedule section was rewritten around the
  new `.range`/`.range-value`/`.range-close` markup, including an explicit
  regression guard (`not.toMatch(/until/i)`) that the pill's text content
  never contains a hold-expiry claim — the one property this ADR is built
  around not faking.
- If Home Assistant's `ecobee` integration ever starts exposing a hold's end
  time, the pill gains a natural place to show it (matching the reference
  screenshot exactly) without a structural change — ADR-0003's own closing
  note ("if HA ever exposes per-call hold durations, revisit") still applies.
