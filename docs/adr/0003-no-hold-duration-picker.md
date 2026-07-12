# No hold-duration picker

**Status: Superseded by [ADR-0004](./0004-no-hold-or-resume-schedule.md)**, itself
now extended by **[ADR-0012](./0012-opt-in-resume-schedule.md)**: the Card dropped
Hold/Resume Schedule entirely (ADR-0004), then reintroduced an opt-in, ecobee-only
Resume Schedule pill with no Hold indicator (ADR-0012) — the hold-duration prompt
described below stays gone either way; only the resume half ever came back, and
only behind an explicit config toggle. The reasoning here (HA can't express
per-call durations) is retained as the origin of the broader ADR-0004 decision.

The physical ecobee, after a temperature or Comfort Setting change, prompts for a
hold duration ("2 hours / until next activity / until I change it"). ecosee
deliberately omits this prompt. Home Assistant's `climate.set_temperature` applies
changes as a hold **until the next scheduled transition** and exposes no per-call
duration; "indefinite" is only a global integration config, not a per-action choice.
Showing the device's three-way duration prompt would mean two of the three options
silently do nothing.

Instead, a change creates a hold-until-next-transition (the HA default), the Home
Screen shows a **Hold** indicator, and a **Resume Schedule** action clears it via the
ecobee `resume_program` service (hidden for entities with no schedule concept).

## Consequences

- The card is intentionally *less* faithful than the device here, to avoid faking
  controls. A future contributor seeing the "missing" duration prompt should read
  this before re-adding it.
- If HA ever exposes per-call hold durations, this ADR should be revisited.
