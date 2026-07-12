# Opt-in Resume Schedule (ecobee-only)

**Status: Accepted.** Origin: owner report ("when you change the heat/cool setpoint,
the ecobee goes into a manual override until the next schedule... I'd like that same
feature — click an ✕ to go back to the schedule, via `ecobee.resume_program`").

**Extends [ADR-0004](./0004-no-hold-or-resume-schedule.md)**, which this does not
reverse outright: ADR-0004's reasoning stands as the Card's *default* — every
argument it makes about HA having no portable hold concept is still true for a
generic `climate` entity. This ADR carves out a narrow, **explicitly opt-in**
exception for the one case where the Card *can* back the control honestly: a bound
entity that is genuinely driven by Home Assistant's own `ecobee` integration.

## Context

ADR-0004 rejected Hold/Resume for three reasons: (1) no portable "is this entity
currently on a hold" signal, (2) no portable hold-expiry time, (3) `resume_program` is
`ecobee`-domain-specific — absent on HomeKit-paired ecobees, Nest, and generic
thermostats — and *detecting* the backing integration to conditionally offer Resume
would make the Card lie about a control it usually couldn't back.

Revisiting each with the actual `ecobee` integration source
(`homeassistant/components/ecobee/climate.py`, checked against `home-assistant/core`
directly rather than assumed):

- **The hold-expiry time is confirmed still unavailable.** The ecobee API's raw hold
  event carries `startDate`/`endDate`, but the integration's
  `extra_state_attributes` never surfaces them — only `climate_mode`,
  `equipment_running`, `fan`, `fan_min_on_time`, and the sensor-participation lists.
  ADR-0003's "no next-transition time" stands; the Card still cannot show the
  device's `until 5:28pm` text and does not attempt to.
- **A hold *is* detectable, but only for this one integration and only
  best-effort.** `climate_mode` (an `ecobee`-only attribute) is the comfort setting
  the *program* currently calls for; the entity's ordinary `preset_mode` is what's
  *actually* active. `preset_mode`'s own implementation walks the thermostat's
  running `events`: a hold with no comfort-setting reference returns the sentinel
  `"temp"`, a held comfort setting returns *that* setting's name, an indefinite Away
  hold returns a distinct sentinel, and only when nothing is running does it fall
  through to the program's own current comfort setting (matching `climate_mode`).
  So `climate_mode !== preset_mode` reliably means "not following the schedule right
  now" for a real `ecobee`-integration entity. It means nothing for any other
  integration, which won't expose `climate_mode` at all.
- **The integration-detection objection is sidestepped, not answered, by opt-in.**
  ADR-0004 was right that the Card must not *guess* whether an entity backs
  `resume_program` — but it does not need to guess if the user tells it. A new
  `resume_program` config key (absent ⇒ off, matching every opt-in key in this
  Card — `standby_screen`, `mode_color`, etc.) is the user asserting "my bound
  entity is a real `ecobee`-integration thermostat," the same trust boundary
  `temperature_entity` and `humidity_entity` already rely on for their own overrides.

## Decision

- A new **opt-in** config key, `resume_program: boolean` (absent ⇒ `false`, in the
  visual editor as a plain checkbox). Off, the Card is byte-for-byte what ADR-0004
  described: setpoint ovals only, no Resume control anywhere.
- On, a **Resume Schedule** pill renders beneath the setpoint ovals — *never
  replacing* them (ADR-0004's "no combined range pill" stands; the ovals keep
  showing the live heat/cool setpoints exactly as before) — whenever:
  1. Setpoints are active (nothing to resume from Off/Dry/Fan only), and
  2. The best-effort hold check above can't rule out an active hold: `climate_mode`
     and `preset_mode` differ, **or** `climate_mode` is absent from the entity
     altogether (a non-`ecobee` entity, or a HomeKit-paired ecobee) — degrading to
     "assume a hold" rather than silently hiding a control the user explicitly
     opted into. A user who enables this on an entity that never exposes
     `climate_mode` gets a Resume pill that's simply always present whenever
     setpoints show, same as if they'd chosen "always show" outright.
  3. There is deliberately no third "definitely not on a hold" outcome that hides
     the control on a false negative — the two outcomes are "hide because we know
     the schedule and hold don't differ" and "show because we can't be sure or
     because they do differ."
- Tapping the pill's ✕ calls `ecobee.resume_program` with `resume_all: false` — the
  same scope as the device's own Resume ✕ (clears the current hold only, not the
  whole event queue/vacation stack).
- No hold-expiry text (still unavailable, see above) and no `hass`-based integration
  sniffing (the opt-in key *is* the assertion).

## Consequences

- `climate/resume-schedule.ts` is the seam: `resumeAvailable` (the gating logic
  above, pure and unit-tested against fabricated `climate_mode`/`preset_mode`
  combinations) and `resumeProgramCall` (the `ServiceCall` builder). Mirrors the
  existing per-concern seam shape (`temperature-adjust.ts`, `comfort-setting.ts`).
- `HomeView` gains `resumeAvailable: boolean`, derived in `toHomeView` alongside the
  setpoints it depends on — every hand-built `HomeView` test fixture across the
  suite now sets it explicitly (no default it can silently inherit).
- "Resume Schedule" re-enters the Card's vocabulary, but scoped: it is documented in
  CONTEXT.md as an ecobee-integration-specific, opt-in affordance, not a generic
  Setpoint concept. "Hold" itself stays out of the UI copy — the pill reads "Resume
  Schedule," not "Hold Active," since the Card cannot always positively confirm a
  hold (see the "assume a hold" degradation above) and should not claim to.
- If Home Assistant ever grows a portable hold/resume concept, ADR-0004's closing
  note still applies — this ADR would then likely fold into that generic support
  rather than staying `ecobee`-only.
