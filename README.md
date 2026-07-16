<p align="center">
  <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/logo.png" width="120" alt="ecosee" />
</p>

<h1 align="center">ecosee</h1>

<p align="center">
  A more modern way to see and control any Home Assistant thermostat. Big, legible
  temperature, live heating and cooling status, and every control one tap away, on
  the <code>climate</code> entity you already have.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-auto.png" width="360" alt="ecosee home screen: large 75 degrees with heat and cool setpoint pills and a cooling edge glow" />
</p>

<p align="center">
  <a href="https://shaelr.github.io/ecosee/"><b>Try the live demo</b></a>
  &nbsp;·&nbsp;
  <a href="#install-hacs">Install</a>
  &nbsp;·&nbsp;
  <a href="#configuration">Configure</a>
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=shaelr&repository=ecosee&category=plugin"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open the ecosee repository inside HACS on your Home Assistant instance." /></a>
</p>

ecosee is a modern replacement for Home Assistant's default thermostat card.
Point it at any `climate` entity and you get a clean, full-screen view: a large
current temperature, the room humidity, a soft glow around the edge while the
system is heating or cooling, and rounded setpoint pills you tap to adjust. It
reads whatever your thermostat exposes, so it looks right on a high-end smart
thermostat and a basic one alike.

The demo above runs the real card in your browser against sample data, with no
Home Assistant behind it. Tap the card to open its controls.

## Controls

Tap the card to reach a control. Each one opens over the home screen and returns
to it on its own after a moment of no input, so the card always settles back to
the temperature.

<table>
  <tr>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-temperature.png" width="230" alt="Temperature adjust screen" /><br />
      <b>Adjust temperature</b><br />
      <sub>Scrub the wheel or tap plus / minus</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-system-mode.png" width="230" alt="System mode picker" /><br />
      <b>System mode</b><br />
      <sub>Heat, Cool, Heat / Cool, Off</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-comfort.png" width="230" alt="Comfort setting picker" /><br />
      <b>Comfort setting</b><br />
      <sub>Home, Away, Sleep and your own presets</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-fan.png" width="230" alt="Fan mode picker" /><br />
      <b>Fan</b><br />
      <sub>Speed and circulation, when supported</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-sensors.png" width="230" alt="Room sensors list" /><br />
      <b>Room sensors</b><br />
      <sub>Any temperature entities you list</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-weather.png" width="230" alt="Weather screen with current conditions and forecast" /><br />
      <b>Weather</b><br />
      <sub>Current conditions and forecast</sub>
    </td>
  </tr>
</table>

A main menu (the gear, top right) gathers the same screens in one place.

<p align="center">
  <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/overlay-menu.png" width="230" alt="Main menu listing System, Sensors, Weather" />
</p>

## Works with what you have

The card shows only what your entity actually reports. A capable thermostat
lights up every element; a basic one shows a clean, minimal face instead. There
are no empty boxes and no broken controls either way.

<table>
  <tr>
    <td align="center" width="25%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-heating.png" width="200" alt="Home screen while heating" /><br />
      <sub>Heating</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-cooling.png" width="200" alt="Home screen while cooling" /><br />
      <sub>Cooling</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-off.png" width="200" alt="Home screen with the system off" /><br />
      <sub>Off</sub>
    </td>
    <td align="center" width="25%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-minimal.png" width="200" alt="Home screen for a basic thermostat" /><br />
      <sub>Basic thermostat</sub>
    </td>
  </tr>
</table>

Two extras you can switch on when you want them: air-quality and UV gauges along
the bottom, and a dimmed standby screen with the time for when the card sits idle
on a wall tablet.

<table>
  <tr>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/home-air-quality.png" width="230" alt="Home screen with air quality and UV gauges" /><br />
      <sub>Air quality and UV gauges</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/shaelr/ecosee/HEAD/docs/screenshots/standby.png" width="230" alt="Dimmed standby screen showing the time" /><br />
      <sub>Standby screen</sub>
    </td>
  </tr>
</table>

## Install (HACS)

If you have [HACS](https://hacs.xyz), one click does it:

[![Open the ecosee repository inside HACS on your Home Assistant instance.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=shaelr&repository=ecosee&category=plugin)

That opens your Home Assistant, adds this repository to HACS, and drops you on its
download page. Download it and reload your browser. HACS registers the card
resource for you.

<details>
<summary>Prefer to add it by hand?</summary>

1. In HACS, open the menu (top right) and choose **Custom repositories**. Add
   `https://github.com/shaelr/ecosee` as a **Dashboard** repository.
2. Install **ecosee** from the list.
3. If HACS does not add the resource for you, add it under
   **Settings → Dashboards → Resources**: URL `/hacsfiles/ecosee/ecosee.js`,
   type **JavaScript Module**.

</details>

Then add the card to a dashboard (see [Configuration](#configuration)).

## Configuration

Add the card through your dashboard's visual editor, or in YAML. Both write the
same options; only `entity` is required.

```yaml
type: custom:ecosee-card
entity: climate.living_room # required, a climate.* entity
name: Living Room # optional, defaults to the entity's friendly name
weather_entity: weather.home # optional, shows the weather icon and screen
temperature_entity: sensor.living_room_temperature # optional, overrides the thermostat's own current temperature
humidity_entity: sensor.hallway_humidity # optional, overrides the thermostat's own humidity
air_quality_entity: sensor.air_quality_index # optional, adds the AQI gauge
uv_index_entity: sensor.uv_index # optional, adds the UV gauge
schedule_entity: calendar.living_room_schedule # optional, adds the Schedule Main Menu section
show_fan: auto # optional, auto | always | never — the Home Screen fan shortcut
standby_screen: true # optional, dims to a clock when left idle
corner_style: squircle # optional, squircle | rounded | square — the card's corner treatment
equipment_glow: true # optional, the colored heating/cooling edge glow
mode_color: false # optional, tints the System Mode icon by equipment status like the ecobee
resume_program: false # optional, adds a Resume Schedule control (ecobee integration only)
background_color: '#0a0d10' # optional, the card's background — any CSS color, or "transparent"
min_gap: 3 # optional, minimum heat/cool separation in Heat / Cool (Auto)
min_gap_entity: sensor.ecobee_heat_cool_min_delta # optional, sources the gap from a sensor instead
sensors: # optional, the Sensors screen (see below)
  - sensor.kitchen_temperature
  - entity: sensor.hallway_temperature
    name: Hallway
    occupancy_entity: binary_sensor.hallway_occupancy
```

| Option                   | Required | Description                                                                                                                                                                               |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`                 | yes      | The `climate.*` entity the card is bound to. One card drives one thermostat.                                                                                                              |
| `name`                   | no       | Label override. Defaults to the entity's friendly name.                                                                                                                                   |
| `weather_entity`         | no       | A `weather` entity. Enables the weather icon and the Weather screen.                                                                                                                      |
| `temperature_entity`     | no       | Overrides the thermostat's own current-temperature reading everywhere the card shows it (Home Screen, Standby Screen, and the Sensors screen's thermostat card) with this entity's value. |
| `humidity_entity`        | no       | Overrides the thermostat's own humidity reading with this entity's value.                                                                                                                 |
| `air_quality_entity`     | no       | An entity carrying a US EPA air-quality index. Adds the AQI gauge.                                                                                                                        |
| `uv_index_entity`        | no       | An entity carrying a UV index. Adds the UV gauge.                                                                                                                                         |
| `fan_min_on_time_entity` | no       | A `number` entity for fan minimum runtime. Adds a selector to the Fan screen.                                                                                                             |
| `schedule_entity`        | no       | A `calendar` entity representing the weekly comfort-setting schedule. Adds the Schedule Main Menu section — see below.                                                                    |
| `sensors`                | no       | Temperature entities for the Sensors screen (see below).                                                                                                                                  |
| `inactivity_timeout`     | no       | Seconds an open control waits, idle, before returning home. `0` disables. Default 25.                                                                                                     |
| `standby_screen`         | no       | Dim to a minimal clock display when left idle. Default off.                                                                                                                               |

#### Advanced

Finer-grained knobs for tuning specific screens. `show_fan`, `min_gap`,
`min_gap_entity`, `resume_program`, `corner_style`, `equipment_glow`,
`mode_color`, and `background_color` are all also in the visual editor;
`standby` is YAML-only.

| Option             | Required | Description                                                                                                                                                                                                                                                          |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show_fan`         | no       | When to show the Home Screen fan shortcut: `auto` (only for fans with real speeds), `always` (any fan, On/Auto included), `never`. Default `auto`.                                                                                                                   |
| `standby`          | no       | Hide individual elements of the standby (idle) screen — see below. Ignored unless `standby_screen` is on.                                                                                                                                                            |
| `mode_color`       | no       | Tints the Home Screen System Mode icon by equipment status, like the ecobee device: blue while cooling, amber while heating, split left/right for Heat / Cool (Auto). Default off.                                                                                   |
| `min_gap`          | no       | Minimum separation between the heat and cool setpoints in Heat / Cool (Auto), in your temperature unit. Default 3°F / 1.5°C. `0` lets them meet. Ignored while `min_gap_entity` has a reading.                                                                       |
| `min_gap_entity`   | no       | A `sensor` entity carrying the minimum gap instead of a fixed `min_gap` — see below.                                                                                                                                                                                 |
| `corner_style`     | no       | The card's outer corner treatment: `squircle` (the ecobee Premium's full-bubble motif), `rounded` (a smaller, conventional radius), or `square` (sharp corners). Default `squircle`.                                                                                 |
| `equipment_glow`   | no       | Whether the colored edge glow (blue cooling / amber heating) is shown. Default `true`; set `false` to hide it on every screen.                                                                                                                                       |
| `resume_program`   | no       | Adds a Resume Schedule control beneath the setpoints — see below. **ecobee integration only.** Default off.                                                                                                                                                          |
| `background_color` | no       | Overrides the card's background everywhere — Home Screen, Standby Screen, and any open menu/picker: any CSS color (`#1a1a2e`, `rgba(...)`, a named color), or `transparent` for no background at all. Picker/chip text stays legible either way. Default near-black. |

##### Resume Schedule (ecobee integration only)

Changing a setpoint puts an ecobee into a manual override ("Hold") until the next
scheduled transition; the physical device offers a **Resume Schedule** control to
clear that and hand control back to the program. Home Assistant has no portable way
to represent this for an arbitrary `climate` entity (see
[ADR-0004](docs/adr/0004-no-hold-or-resume-schedule.md)), so it stays off by
default and does not appear for other thermostats.

Turning `resume_program` on adds that control beneath the setpoint ovals — text
plus a small circled ✕ — for a thermostat bound through Home Assistant's own
**ecobee integration**. Tapping it calls `ecobee.resume_program`. The card shows it
on a best-effort basis: it compares the entity's `climate_mode` (what the schedule
currently calls for) against `preset_mode` (what's actually active) and shows the
control when they differ or when it can't tell (see
[ADR-0012](docs/adr/0012-opt-in-resume-schedule.md) for the full reasoning). There
is no `until 5:28pm` countdown — Home Assistant doesn't expose a hold's end time,
so the card doesn't fake one.

```yaml
resume_program: true
```

##### Heat / Cool (Auto) minimum gap

Most air conditioners in Heat / Cool (Auto) mode require a minimum gap (deadband)
between the heating and cooling targets (commonly 3°F). When you drag one setpoint
toward the other, the card keeps this gap by **pushing** the paired setpoint along
(the same way an ecobee or Nest thermostat does), so the near-overlap range stays
responsive instead of appearing stuck. Set `min_gap` if your equipment needs a
different spread, or `min_gap: 0` to let the two setpoints touch.

```yaml
min_gap: 3 # keep heat and cool at least 3° apart in Auto (default 3°F / 1.5°C)
```

If your thermostat integration exposes its own configured gap as a sensor — for
example [ha-ecobee](https://github.com/shaelr/ha-ecobee)'s `Heat/Cool Min Delta`
diagnostic sensor, which mirrors the ecobee's own `heatCoolMinDelta` setting —
point `min_gap_entity` at it instead of typing the number in by hand. It's used
whenever it has a valid reading, so the card's gap always matches the
thermostat's actual setting; `min_gap` (or the default) is the fallback for
whenever the entity is unset or briefly unavailable.

```yaml
min_gap_entity: sensor.living_room_heat_cool_min_delta
```

##### Schedule

Point `schedule_entity` at a `calendar` entity representing your thermostat's
weekly comfort-setting schedule — for example
[ha-ecobee](https://github.com/shaelr/ha-ecobee)'s own Schedule calendar, which
represents the ecobee's schedule as one calendar event per contiguous run of a
comfort setting — and the card adds a **Schedule** section to the Main Menu.

```yaml
schedule_entity: calendar.living_room_schedule
```

It shows one day at a time (the day strip along the top switches days) as an
ordered list of blocks, each labeled with when it starts. Tapping a block opens
a Start Time picker where you can move that block's start for that day (the
block before it shrinks or grows to fill the gap) or remove it entirely
(merging it into the block before it — there's no "empty" schedule slot to
remove into, so removing a block always means handing its time back to
whichever comfort setting precedes it). A block that was already active at
midnight has no earlier block on that day to adjust against, so it's shown but
not editable.

Adding a brand-new block and copying a day's schedule to another day aren't in
yet — this first pass covers viewing the schedule and adjusting the transitions
already on it.

##### Standby screen elements

`standby` is a YAML-only block (not in the visual editor) that hides individual
elements of the dimmed idle display. Each toggle defaults to shown; set one to
`false` to hide it. Hiding `outdoor_temp` removes the whole top row (the weather
glyph lives there); hiding just `weather` keeps the temperature but drops its glyph.

```yaml
standby_screen: true
standby:
  weather: false # hide the weather condition glyph
  outdoor_temp: false # hide the outdoor temperature (removes the top row)
  current_temp: false # hide the large current temperature
  glow: false # hide the equipment status edge glow (the outer glowing ring)
```

### The Sensors screen

`sensors` curates which temperature readings appear under the Sensors screen. The
thermostat's own temperature is listed first automatically, so this is for the
extra rooms you want alongside it. Each item is either a bare entity id or an
object; `name` and `occupancy_entity` are both settable from the visual editor
(each sensor's entity picker shows a name field and an occupancy-entity field
beneath it) as well as in YAML.

| Field              | Required | Description                                                                                                                   |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `entity`           | yes      | A temperature entity (value in its state or `current_temperature`).                                                           |
| `name`             | no       | Label override. Defaults to the entity's friendly name.                                                                       |
| `occupancy_entity` | no       | A binary occupancy entity that backs an "Occupied" badge. Auto-detected for ecobee remote sensors; set this only to override. |

Sensors that are missing, unavailable, or non-numeric are dropped. The
"Occupied" / "Unoccupied" badge appears whenever an occupancy sensor can be found:
for **ecobee remote sensors it is automatic** — the card pairs each room's occupancy
sensor to its temperature sensor because they share a device, so you get the badge
with no extra config. Set `occupancy_entity` only to point at a specific binary
sensor or to override that automatic pairing; a sensor with no occupancy source
shows just its temperature.

## Development

Run `npm run dev` for a live preview harness that renders the card against sample
data with no Home Assistant behind it (the same thing published as the live demo).
See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full build, test, and release
workflow.

## License

MIT
