import { LitElement, html, css, nothing, type TemplateResult, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { CARD_TYPE, parseConfig, type EcoseeCardConfig } from './config';
import { toHomeView, type HomeView } from './climate/home-view';
import {
  toTempAdjustModel,
  selectSetpoint,
  type TempAdjustModel,
  type Setpoint,
} from './climate/temperature-adjust';
import { toSystemModeModel } from './climate/system-mode';
import { toComfortSettingModel } from './climate/comfort-setting';
import { toComfortSetpointsModel } from './climate/comfort-setpoint';
import { toFanModel } from './climate/fan';
import { resumeProgramCall } from './climate/resume-schedule';
import { toFurnaceFilterModel } from './climate/furnace-filter';
import { toTabBarModel, TAB_SECTIONS, type TabBarModel, type TabTarget } from './menu/tab-bar';
import { InactivityTimer, inactivityTimeoutMs, standbyReturnMs } from './overlays/inactivity-timer';
import type { SystemSelectTarget } from './overlays/system-overlay';
import { toSensorsModel } from './sensors/sensors';
import {
  toWeatherModel,
  getForecastsCall,
  parseForecastResponse,
  type ForecastEntry,
  type ForecastType,
  type WeatherForecasts,
} from './weather/weather';
import type { ServiceCall } from './climate/service-call';
import {
  toScheduleModel,
  toScheduleBlocks,
  getScheduleEventsCall,
  parseScheduleResponse,
  moveBlockStart,
  removeBlock,
  addBlockCall,
  copyDayCalls,
  scheduleDays,
  dayStart,
  dayName,
  type RawScheduleEvent,
  type ScheduleUpdateMessage,
} from './schedule/schedule';
import { tokens } from './styles/tokens';
import { createCanvasMeasure, filterDegenerateFamilies } from './styles/font-probe';
import { ensureBundledFont } from './styles/bundled-font';
import { resolveDeviceSize } from './device-size';
import { pickThemeTextColor } from './styles/theme-contrast';
import { resolveCssColor } from './styles/resolve-css-color';
import type { HomeAssistant, LovelaceCard } from './types/hass';
import type { HomeActionDetail } from './screens/home-screen';
import { toStandbyView } from './screens/standby-view';
import './screens/home-screen';
import './screens/standby-screen';
import './overlays/overlay-shell';
import './overlays/temperature-overlay';
import './overlays/system-mode-overlay';
import './overlays/comfort-setting-overlay';
import './overlays/system-overlay';
import './overlays/fan-overlay';
import './overlays/sensors-overlay';
import './overlays/weather-overlay';
import './overlays/schedule-overlay';
import './overlays/schedule-start-time-overlay';
import './overlays/schedule-add-block-overlay';
import './overlays/schedule-copy-overlay';
import './overlays/comfort-setpoints-overlay';
import './overlays/comfort-setpoint-overlay';
import './overlays/furnace-filter-overlay';
import { EDITOR_TYPE } from './editor/ecosee-card-editor';
import './editor/ecosee-card-editor';

/** An Overlay that can mount over the Home Screen. `system` is the Main Menu's
 *  System sub-screen (the hub holding the System Mode + Comfort Setting selectors);
 *  `system-mode` / `comfort-setting` are the focused pickers it routes to; `fan`,
 *  `sensors`, `schedule`, `setpoints`, and `filter` are the rest of the Main Menu
 *  sections, reached via the gear and switched between with the bottom tab bar.
 *  `schedule-start-time`, `schedule-add-block`, and `schedule-copy` are
 *  Schedule's own pickers (ADR-0014); `setpoint-adjust` is Comfort Setpoints'
 *  own picker (ADR-0015) — all reached the same way `system-mode`/
 *  `comfort-setting` are reached from `system`. */
type OverlayKind =
  | 'temperature'
  | 'system-mode'
  | 'comfort-setting'
  | 'system'
  | 'fan'
  | 'sensors'
  | 'weather'
  | 'schedule'
  | 'schedule-start-time'
  | 'schedule-add-block'
  | 'schedule-copy'
  | 'setpoints'
  | 'setpoint-adjust'
  | 'filter';

/**
 * One Overlay's wiring, gathered in a single place: whether it has anything to show
 * (`available`, which gates opening), an optional side-effect when it opens or
 * closes (the Temperature Adjust seed, the Weather forecast fetch), and how to
 * render its content against the current `hass`. The card drives every Overlay
 * through this descriptor instead of a per-kind branch, so adding one is a single
 * table entry rather than edits in four places.
 */
interface OverlayDescriptor {
  available(hass: HomeAssistant, config: EcoseeCardConfig): boolean;
  onOpen?(hass: HomeAssistant, config: EcoseeCardConfig): void;
  render(hass: HomeAssistant, config: EcoseeCardConfig): TemplateResult | typeof nothing;
}

// Injected by vite.config.ts's `define` from package.json at build time, so
// the console banner below can never drift from the real published version
// again (it had, silently, since v0.9.0 — always printing "v0.10.0" — which
// is exactly the kind of thing that makes "is this dashboard actually running
// the fix I just shipped" hard for a user to self-check).
declare const __ECOSEE_VERSION__: string;
const VERSION = __ECOSEE_VERSION__;

/**
 * `<ecosee-card>` — the host Lovelace element. It owns the `hass` wiring and
 * config, derives the degraded HomeView, and delegates rendering to
 * <ecosee-home-screen>. It also owns the overlay shell: opening an Overlay over
 * the Home Screen, dismissing it, and applying the service calls Overlays emit.
 */
@customElement(CARD_TYPE)
export class EcoseeCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private _config?: EcoseeCardConfig;
  /** The overlay navigation stack (hub-and-picker, CONTEXT.md). The top is the
   *  visible Overlay; dismissing pops one level, so a picker reached *through* the
   *  Main Menu returns to the menu, while one opened straight from the Home Screen
   *  returns to Home. Empty ⇒ the bare Home Screen. */
  @state() private _nav: OverlayKind[] = [];
  /** Open-time *seed* for the Temperature Adjust overlay (not the live edit
   *  state — the overlay owns that). Captured once on open and held by reference,
   *  not recomputed per render, so the overlay's in-progress edits survive `hass`
   *  updates rather than being reset on every state push. */
  @state() private _tempSeed?: TempAdjustModel;
  /** Which setpoint the next Temperature Adjust open should foreground, set when the
   *  open came from a specific setpoint oval (heat / cool) rather than the current-
   *  temperature number. Consumed and cleared by the temperature descriptor's
   *  `onOpen`; `undefined` lets the model keep its own default (cool in Auto). */
  private _tempSetpoint?: Setpoint;
  /** Forecast data for the Weather overlay, fetched via the `weather.get_forecasts`
   *  service when it opens (modern HA exposes the forecast through a service, not a
   *  static attribute — ADR-0001). `undefined` until the fetch resolves; the seam
   *  degrades page 2 / the intra-day periods while it is absent. Cleared on close
   *  so a re-open refetches. */
  @state() private _weatherForecasts?: WeatherForecasts;

  /** Which day of the current week the Schedule sub-screen shows (`Date#getDay()`
   *  index, Sunday-first — matches the day strip and `dayStart`/`dayName`).
   *  Deliberately NOT reset on close/reopen (unlike the other overlays' per-open
   *  seeds) — returning to a previously-viewed day is more useful than always
   *  snapping back to today. Initialized to today's index. */
  @state() private _scheduleDayIndex = new Date().getDay();
  /** The selected day's raw calendar events, fetched via `calendar.get_events`
   *  when Schedule opens or the day changes (ADR-0014, mirroring
   *  `_weatherForecasts`'s fetch-on-open shape). Empty until the fetch resolves —
   *  the seam degrades to "no blocks yet" rather than "unavailable". */
  @state() private _scheduleEvents: RawScheduleEvent[] = [];
  /** Which of the selected day's blocks the Schedule Start Time picker is editing
   *  (an index into `toScheduleBlocks`'s result, stable across a write since a
   *  move never reorders blocks — only grows/shrinks adjacent ones). `undefined`
   *  ⇒ the picker has nothing to show, matching `_tempSetpoint`'s per-open-seed
   *  shape. Cleared on close (`_clearOverlaySeeds`). */
  @state() private _scheduleEditingBlockIndex?: number;

  /** Which Comfort Setpoints field the Setpoint Adjust picker is editing (a
   *  preset name + `'heat'`/`'cool'`), set when a Comfort Setpoints card's pill
   *  is tapped (ADR-0015). `undefined` ⇒ the picker has nothing to show,
   *  matching `_scheduleEditingBlockIndex`'s per-open-seed shape. Cleared on
   *  close (`_clearOverlaySeeds`). */
  @state() private _setpointSelection?: { preset: string; field: Setpoint };

  /** Auto-revert countdown (issue #13): collapses any open Overlay back to the
   *  Home Screen after a configurable idle interval, mirroring the device. Armed
   *  while an Overlay is open, reset on interaction within it, cancelled on manual
   *  dismiss / unmount. */
  private readonly _inactivity = new InactivityTimer(() => this._revertToHome());

  /** Whether the Card is showing the Standby Screen (issue #65) instead of the Home
   *  Screen. Top-level view choice, separate from the Overlay stack: only ever true
   *  from the bare Home Screen, cleared on any interaction with the Standby Screen. */
  @state() private _standby = false;

  /** Home → Standby idle countdown (issue #65): a SECOND {@link InactivityTimer},
   *  distinct from `_inactivity`. Armed only while sitting on the bare Home Screen
   *  with the feature enabled, reset on interaction there, stopped while an Overlay
   *  is open or already on Standby; on expiry it switches to the Standby Screen. */
  private readonly _standbyTimer = new InactivityTimer(() => this._enterStandby());

  /** Watches the dashboard slot so the fixed-canvas device can be scaled to fit
   *  (issue #35 / #36). The Home Screen and every Overlay are laid out once at a
   *  fixed base size and sized in cqw; deriving the container size from
   *  `clamp(…, 100%, …)` + `aspect-ratio` instead is what Gecko resolves
   *  late/collapsed, squashing the layout in Firefox/Zen. Measuring the width here
   *  and publishing `--ecosee-scale` (applied as one transform) sidesteps that and
   *  keeps the layout from ever reflowing per-width. */
  private _resizeObserver?: ResizeObserver;

  /** The Overlay currently on top of the stack, if any. */
  private get _overlay(): OverlayKind | undefined {
    return this._nav[this._nav.length - 1];
  }

  /** Every Overlay's wiring in one table (see {@link OverlayDescriptor}). Keyed by
   *  kind, so each Overlay's availability, open/close side-effects, and render live
   *  together — replacing the former per-kind `if`-chain plus the bespoke opener
   *  methods. The render templates carry no event handlers: editing Overlays emit
   *  the unified `ecosee-service-call` and the hubs emit their navigation events,
   *  all caught once on the <ecosee-overlay> shell in `_renderOverlay`. */
  private readonly _overlays: Record<OverlayKind, OverlayDescriptor> = {
    temperature: {
      available: (hass, config) => toTempAdjustModel(hass, config).available,
      // Seed the editing model once on open and hold it by reference, so the
      // overlay's in-progress edits survive `hass` pushes (see `_tempSeed`). When
      // the open came from a specific setpoint oval, foreground that setpoint so the
      // scrubber edits the one the user tapped (a no-op if it isn't editable).
      onOpen: (hass, config) => {
        const model = toTempAdjustModel(hass, config);
        this._tempSeed = this._tempSetpoint ? selectSetpoint(model, this._tempSetpoint) : model;
        this._tempSetpoint = undefined;
      },
      render: (_hass, config) =>
        this._tempSeed
          ? html`
              <ecosee-temperature-overlay
                .model=${this._tempSeed}
                .entityId=${config.entity}
              ></ecosee-temperature-overlay>
            `
          : nothing,
    },
    'system-mode': {
      available: (hass, config) => toSystemModeModel(hass, config).available,
      // Computed live (not seeded): the picker holds no in-progress edit, so the
      // highlight tracks the entity's reported mode as `hass` updates after a write.
      render: (hass, config) => html`
        <ecosee-system-mode-overlay
          .model=${toSystemModeModel(hass, config)}
          .entityId=${config.entity}
        ></ecosee-system-mode-overlay>
      `,
    },
    'comfort-setting': {
      available: (hass, config) => toComfortSettingModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-comfort-setting-overlay
          .model=${toComfortSettingModel(hass, config)}
          .entityId=${config.entity}
        ></ecosee-comfort-setting-overlay>
      `,
    },
    system: {
      // The System sub-screen hub backs either selector; it drops whichever lacks
      // data (graceful degradation, ADR-0001).
      available: (hass, config) =>
        toSystemModeModel(hass, config).available || toComfortSettingModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-system-overlay
          .systemMode=${toSystemModeModel(hass, config)}
          .comfort=${toComfortSettingModel(hass, config)}
          .equipment=${toHomeView(hass, config).equipment}
        ></ecosee-system-overlay>
      `,
    },
    fan: {
      available: (hass, config) => toFanModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-fan-overlay
          .model=${toFanModel(hass, config)}
          .entityId=${config.entity}
        ></ecosee-fan-overlay>
      `,
    },
    sensors: {
      available: (hass, config) => toSensorsModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-sensors-overlay .model=${toSensorsModel(hass, config)}></ecosee-sensors-overlay>
      `,
    },
    weather: {
      available: (hass, config) => toWeatherModel(hass, config).available,
      // Current conditions are live from `hass`; the forecast (page 2 / intra-day
      // periods) is fetched async via `weather.get_forecasts` and threaded in, the
      // model degrading while it is still absent (ADR-0001).
      onOpen: () => {
        void this._loadForecasts();
      },
      render: (hass, config) => html`
        <ecosee-weather-overlay
          .model=${toWeatherModel(hass, config, this._weatherForecasts)}
        ></ecosee-weather-overlay>
      `,
    },
    schedule: {
      available: (hass, config) =>
        toScheduleModel(hass, config, [], this._scheduleSelectedDate(), this._scheduleDayIndex)
          .available,
      // The selected day's blocks are fetched async via `calendar.get_events` and
      // threaded in, mirroring Weather's forecast fetch (ADR-0014); the model
      // degrades to "no blocks yet" while it is still absent.
      onOpen: () => {
        void this._loadSchedule();
      },
      render: (hass, config) => html`
        <ecosee-schedule-overlay
          .model=${toScheduleModel(
            hass,
            config,
            this._scheduleEvents,
            this._scheduleSelectedDate(),
            this._scheduleDayIndex,
          )}
          .todayIndex=${new Date().getDay()}
        ></ecosee-schedule-overlay>
      `,
    },
    'schedule-start-time': {
      available: () => this._scheduleEditingBlockIndex !== undefined,
      render: (_hass, config) => {
        const index = this._scheduleEditingBlockIndex;
        if (index === undefined) return nothing;
        const blocks = toScheduleBlocks(this._scheduleEvents, this._scheduleSelectedDate(), config);
        const block = blocks[index];
        if (!block) return nothing;
        return html`
          <ecosee-schedule-start-time-overlay
            .comfortSetting=${block.comfortSetting}
            .dayLabel=${dayName(this._scheduleDayIndex)}
            .startMinutes=${block.startMinutes}
            .canRemove=${index > 0}
          ></ecosee-schedule-start-time-overlay>
        `;
      },
    },
    'schedule-add-block': {
      available: (hass, config) => this._overlays.schedule.available(hass, config),
      render: (hass, config) => html`
        <ecosee-schedule-add-block-overlay
          .comfortSettings=${toComfortSettingModel(hass, config).options}
          .dayLabel=${dayName(this._scheduleDayIndex)}
        ></ecosee-schedule-add-block-overlay>
      `,
    },
    'schedule-copy': {
      available: (hass, config) => this._overlays.schedule.available(hass, config),
      render: () => html`
        <ecosee-schedule-copy-overlay
          .sourceDayLabel=${dayName(this._scheduleDayIndex)}
          .days=${scheduleDays(this._scheduleDayIndex)
            .filter((day) => !day.selected)
            .map((day) => ({ index: day.index, label: dayName(day.index) }))}
        ></ecosee-schedule-copy-overlay>
      `,
    },
    setpoints: {
      available: (hass, config) => toComfortSetpointsModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-comfort-setpoints-overlay
          .model=${toComfortSetpointsModel(hass, config)}
        ></ecosee-comfort-setpoints-overlay>
      `,
    },
    'setpoint-adjust': {
      available: () => this._setpointSelection !== undefined,
      render: (hass, config) => {
        const selection = this._setpointSelection;
        if (!selection) return nothing;
        const preset = toComfortSetpointsModel(hass, config).presets.find(
          (p) => p.preset === selection.preset,
        );
        const value = preset?.[selection.field];
        if (!preset || !value) return nothing;
        return html`
          <ecosee-comfort-setpoint-overlay
            .value=${value}
            .presetLabel=${preset.label}
          ></ecosee-comfort-setpoint-overlay>
        `;
      },
    },
    filter: {
      available: (hass, config) => toFurnaceFilterModel(hass, config).available,
      render: (hass, config) => html`
        <ecosee-furnace-filter-overlay
          .model=${toFurnaceFilterModel(hass, config)}
          .lastChangedEntity=${config.filter_last_changed_entity}
          .resetEntity=${config.filter_reset_entity}
        ></ecosee-furnace-filter-overlay>
      `,
    },
  };

  static override styles = [
    tokens,
    css`
      /* flex-shrink: 0 — confirmed against home-assistant/frontend's own
         hui-vertical-stack-card.ts: its #root is "flex: 1; min-height: 0;"
         inside a "height: 100%" host, the standard flexbox pattern that lets a
         flex item be compressed BELOW its own content's natural height when
         the stack's own available height falls short. A card that self-sizes
         to a square purely from its measured WIDTH (.sizer below) has no way
         to communicate that height back to the outer flex layout ahead of
         time, so without this the host can end up assigned a shorter box than
         .sizer actually renders at — and since .sizer's own height comes from
         a CSS custom property, not the host's box, the excess doesn't reflow
         the stack, it just gets clipped by whatever ancestor has
         overflow: hidden (issue: a Main Menu section with enough rows to
         reach the canvas's true square height got its last row cut off,
         reproducible only inside a vertical-stack — a plain top-level card
         has nothing forcing it to shrink in the first place). flex-shrink: 0
         tells any flex-based wrapper (vertical-stack or otherwise) this card
         is never the one that gives up space when content and container
         height disagree — the wrapper grows to fit it instead. */
      :host {
        display: block;
        flex-shrink: 0;
      }
      /* Fixed-canvas device (issue #35 / #36). .root holds the whole Card laid out
         once at --ecosee-base-size; the ResizeObserver measures the slot and sets
         --ecosee-scale, and we scale .root as a single unit. transform is a purely
         visual scale — the internal layout never reflows — so Home Screen and every
         Overlay render identically in every browser at any width. .sizer collapses
         the Card's layout footprint to the on-screen (scaled) size, since a
         transform alone leaves the un-scaled box reserving space. */
      .sizer {
        width: var(--ecosee-rendered-size, var(--ecosee-base-size, 460px));
        height: var(--ecosee-rendered-size, var(--ecosee-base-size, 460px));
        max-width: 100%;
        margin: 0 auto;
        overflow: hidden;
      }
      .root {
        position: relative;
        width: var(--ecosee-base-size, 460px);
        height: var(--ecosee-base-size, 460px);
        transform: scale(var(--ecosee-scale, 1));
        transform-origin: top left;
      }
    `,
  ];

  setConfig(config: unknown): void {
    this._config = parseConfig(config);
    // Applied as an inline custom property (like --ecosee-scale below) so it beats
    // the shadow DOM's own `:host { --ecosee-bg: #0a0d10 }` default without needing
    // a reactive style block. Every surface (Home, Standby, the Overlay shell)
    // shares this one token — the Overlay shell can safely go transparent too
    // because `render()` below stops mounting <ecosee-home-screen> whenever an
    // Overlay is open, so there is nothing underneath it left to bleed through.
    this._setOrClear('--ecosee-bg', this._config.background_color ?? '');
    this._syncThemeText();
  }

  getCardSize(): number {
    return 4;
  }

  /** Seed config for the dashboard card picker's live preview. HA passes the
   *  available entities; we bind the first `climate.*` one so the preview renders
   *  a real thermostat instead of an empty (invalid) card. Falls back to a
   *  placeholder id when the dashboard has no climate entity at all. */
  static getStubConfig(
    hass: HomeAssistant | undefined,
    entities: readonly string[] | undefined,
    entitiesFallback: readonly string[] | undefined,
  ): Partial<EcoseeCardConfig> {
    const firstClimate = (list: readonly string[] | undefined): string | undefined =>
      list?.find((entityId) => entityId.startsWith('climate.'));
    const entity =
      firstClimate(entities) ??
      firstClimate(entitiesFallback) ??
      firstClimate(hass ? Object.keys(hass.states) : undefined) ??
      'climate.living_room';
    return { entity };
  }

  /** The GUI config editor HA mounts when a user edits the Card from the dashboard
   *  (issue #14). Paired with `getStubConfig`, it makes the Card configurable
   *  without hand-writing YAML; the schema↔config reconciliation lives in
   *  `./editor`. */
  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TYPE);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Track the slot width and pin the device's pixel size (issue #35). The
    // observer fires once on observe, covering the initial size. Guarded for SSR
    // / test environments (happy-dom) that don't implement ResizeObserver.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._syncDeviceScale());
      this._resizeObserver.observe(this);
    }
    this._syncDeviceScale();
    // Home Assistant's masonry dashboard view assigns column widths with its own
    // JS layout pass (balancing column heights across cards), which can still be
    // mid-settle the instant this element connects — the observer's first
    // callback and the synchronous read above can both land before that pass
    // finishes, latching a too-narrow reading in as the "final" size (issue:
    // "sometimes renders smaller than it should"). A double rAF — one to let the
    // browser finish painting whatever layout is already scheduled, a second to
    // catch a further layout HA's own script queues off the first — re-measures
    // once that settling is actually done, without guessing at a fixed delay.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.isConnected) this._syncDeviceScale();
      });
    });
    // Register the bundled Montserrat faces (ADR-0007) before the first
    // probe pass, so the stack's guaranteed fallback exists document-wide.
    ensureBundledFont();
    // Quarantine broken-metric font families (issue #85) — now, once webfonts
    // settle, and again whenever a late font load lands (a dashboard's Montserrat
    // may only arrive after the card is first painted).
    this._syncFontQuarantine();
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', this._onFontsLoaded);
      void document.fonts.ready.then(() => {
        if (this.isConnected) this._syncFontQuarantine();
      });
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Drop pending countdowns so neither can revert / switch (set state on) a
    // detached card.
    this._inactivity.stop();
    this._standbyTimer.stop();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.removeEventListener('loadingdone', this._onFontsLoaded);
    }
  }

  protected override firstUpdated(): void {
    // clientWidth is only meaningful once the host is laid out; the observe-time
    // callback can land before that, so re-measure after the first render.
    this._syncDeviceScale();
    // getComputedStyle only resolves the dashboard's inherited theme variables once
    // connected; setConfig can run before that (HA typically calls it pre-attach), so
    // re-run here too.
    this._syncThemeText();
  }

  protected override updated(changed: PropertyValues): void {
    // Drive the auto-revert countdown off navigation, not off background `hass`
    // pushes: a state update is not user interaction, so it must not extend (nor,
    // by re-arming, reset) the idle timer.
    if (changed.has('_nav') || changed.has('_config')) this._syncInactivityTimer();
    // Same principle for the Home → Standby countdown (issue #65): it is driven by
    // navigation / the standby toggle / config, never by background `hass` pushes.
    if (changed.has('_nav') || changed.has('_config') || changed.has('_standby')) {
      this._syncStandbyTimer();
    }
    // background_color changes what --ecosee-text's contrast check runs against.
    if (changed.has('_config')) this._syncThemeText();
    // Secondary backstop for the same race connectedCallback's double-rAF
    // measurement targets (issue: reported "sometimes renders smaller than it
    // should", not fixed by a browser resize or reload — neither guarantees the
    // host's own box changes size, which is the only thing the ResizeObserver
    // reacts to). The rAF pair is timed for a normal connect; it doesn't cover a
    // host framework re-parenting an already-connected card into a differently-
    // sized slot without a disconnect/reconnect cycle (e.g. a dashboard editor's
    // preview pane), which fires neither connectedCallback nor the ResizeObserver.
    // `hass` pushes are frequent and `_syncDeviceScale` is a cheap no-op once the
    // measurement is already correct (its own unchanged-value guard), so this
    // costs little and catches that remaining gap.
    if (changed.has('hass')) this._syncDeviceScale();
  }

  /** Measure the dashboard slot and set the transform scale that fits the
   *  fixed-canvas device into it (issue #35 / #36). The device is laid out once at
   *  `--ecosee-base-size`; we clamp the slot width between the min/max tokens to
   *  the on-screen size, publish it as `--ecosee-rendered-size` (the .sizer
   *  footprint) and the ratio as `--ecosee-scale` (applied to .root). An unmeasured
   *  Card (0 width, e.g. detached or in tests) leaves the CSS defaults — scale 1,
   *  base-size footprint — in place. Called from the ResizeObserver; at startup
   *  from `connectedCallback` (synchronously, then again after a double rAF, for a
   *  host framework's own JS-driven layout pass — e.g. Home Assistant's masonry
   *  view balancing column widths — still mid-settle at the exact instant this
   *  element connects) and `firstUpdated` (the observer's first callback can land
   *  before the host is laid out); and on every `hass` push (`updated`) as a cheap
   *  self-heal for a host framework re-parenting an already-connected card into a
   *  differently-sized slot without a disconnect/reconnect cycle (e.g. a dashboard
   *  editor's preview pane), which fires neither connectedCallback nor the
   *  ResizeObserver. Every one of these is a no-op once the reading is already
   *  correct (the unchanged-value guard below), so calling it this often costs
   *  essentially nothing.
   *
   *  This is the fix for `.root` (this file's own CSS) coming out too small; it's
   *  not the only way the Card can render undersized. `.root` itself can be
   *  perfectly correctly sized (this fully resynced) while `<ecosee-home-screen>`/
   *  `<ecosee-standby-screen>` still collapse, because — before their own fix — they
   *  sized themselves by auto-fitting their shadow DOM's fixed-size `.screen`
   *  rather than by directly filling their already-known-correct parent, a
   *  completely different race one level down that this function cannot detect or
   *  correct (it only ever writes `--ecosee-scale`/`--ecosee-rendered-size`,
   *  consumed solely by `.root`'s own transform). See home-screen.ts's own `:host`
   *  doc comment (`position: absolute; inset: 0`, matching `<ecosee-overlay>`,
   *  which never had this bug) for that half of the story — confirmed via
   *  DevTools against a real dashboard showing `.root` a correct 410×410 square
   *  next to a `<ecosee-home-screen>` collapsed to 410×73. A now-removed extra
   *  layer of insurance here (500ms/2000ms timeout backstops, a `_nav` trigger)
   *  had been added chasing that exact symptom before its real cause was found;
   *  it's gone because it mechanistically could never have fixed it — re-running
   *  this function doesn't touch `<ecosee-home-screen>`'s own box at all. */
  private _syncDeviceScale(): void {
    const width = this.clientWidth;
    const styles = getComputedStyle(this);
    const base = parseFloat(styles.getPropertyValue('--ecosee-base-size')) || 460;
    const min = parseFloat(styles.getPropertyValue('--ecosee-min-size')) || 220;
    const max = parseFloat(styles.getPropertyValue('--ecosee-max-size')) || 460;
    const rendered = resolveDeviceSize(width, min, max);
    const scale = rendered > 0 && base > 0 ? rendered / base : 0;
    // The .sizer collapses to the rendered size but the host stays full-slot
    // width (block), so publishing these can't feed back into the observer.
    const nextScale = scale > 0 ? String(scale) : '';
    const nextSize = rendered > 0 ? `${rendered}px` : '';
    if (
      this.style.getPropertyValue('--ecosee-scale') === nextScale &&
      this.style.getPropertyValue('--ecosee-rendered-size') === nextSize
    ) {
      return;
    }
    this._setOrClear('--ecosee-scale', nextScale);
    this._setOrClear('--ecosee-rendered-size', nextSize);
  }

  /** Adopts the dashboard's own `--primary-text-color` for the Skin's general text
   *  (`--ecosee-text` and `--ecosee-text-accent` alike — see tokens.ts for why two)
   *  whenever it clears WCAG AAA against the canvas actually in play — never
   *  blindly, since that theme variable is calibrated for the dashboard's OWN
   *  background, and a light theme's near-black text would otherwise land on this
   *  Skin's near-black canvas and vanish (styles/theme-contrast.ts). Deliberately
   *  does NOT separately probe `--secondary-text-color` for `--ecosee-text-muted`
   *  (tokens.ts mirrors it from `--ecosee-text` instead) — an owner report found
   *  HA's own muted/secondary theme color, even past the AAA bar, still read as
   *  visibly dimmer "subtext" next to this same text, which isn't a distinction
   *  this Skin's readable copy wants. Re-run whenever `_config` changes
   *  (`background_color` is the canvas the check runs against) and once more after
   *  first layout, since `setConfig` can land before the host is connected — before
   *  that, `getComputedStyle` can't see the dashboard's inherited theme variables
   *  yet. A `background_color: 'transparent'` canvas has nothing of the Skin's own
   *  left to contrast against — what's actually behind the card is the dashboard's
   *  own surface, which the theme text color is by definition calibrated for — so
   *  the check is skipped and the theme color is trusted outright. */
  private _syncThemeText(): void {
    const styles = getComputedStyle(this);
    const themeText = styles.getPropertyValue('--primary-text-color').trim();
    const canvas = this._config?.background_color?.trim() || '#0a0d10';
    const transparent = canvas.toLowerCase() === 'transparent';
    const text = transparent
      ? themeText
      : (pickThemeTextColor(themeText, canvas, resolveCssColor) ?? '');
    this._setOrClear('--ecosee-text', text);
    this._setOrClear('--ecosee-text-accent', text);
  }

  private _setOrClear(prop: string, value: string): void {
    if (value) {
      this.style.setProperty(prop, value);
    } else {
      this.style.removeProperty(prop);
    }
  }

  private _onFontsLoaded = (): void => this._syncFontQuarantine();

  /** Drop font families whose metrics THIS engine reports as degenerate (issue
   *  #85: a dashboard-provided Montserrat webfont with zeroed hhea metrics makes
   *  Gecko baseline text at the middle of every line box, mangling the gradient
   *  temperature and the Temperature Adjust chips while Chrome renders fine).
   *  The stack is re-read fresh from the cascade each pass — our own inline
   *  override is cleared first so a theme change or a healthier late-loading
   *  font can undo a quarantine rather than feed back into it. Inert wherever
   *  canvas TextMetrics are unavailable (SSR, jsdom/happy-dom tests).
   *  See src/styles/font-probe.ts and docs/adr/0005-cross-browser-typography.md. */
  private _syncFontQuarantine(): void {
    const measure = createCanvasMeasure();
    if (!measure) return;
    this.style.removeProperty('--ecosee-font');
    const stack = getComputedStyle(this).getPropertyValue('--ecosee-font');
    if (!stack.trim()) return;
    const filtered = filterDegenerateFamilies(stack, measure);
    if (filtered !== null) this.style.setProperty('--ecosee-font', filtered);
  }

  /** Arm the auto-revert countdown while an Overlay is open — re-arming on each
   *  navigation step, which doubles as an interaction reset — and cancel it once
   *  back on the bare Home Screen. */
  private _syncInactivityTimer(): void {
    if (this._nav.length > 0 && this._config) {
      this._inactivity.start(inactivityTimeoutMs(this._config));
    } else {
      this._inactivity.stop();
    }
  }

  /** Arm the Home → Standby countdown (issue #65) only while sitting on the bare
   *  Home Screen with the feature enabled — re-arming on each navigation step /
   *  toggle, which doubles as an interaction reset. Stopped when an Overlay opens
   *  (the countdown does not run there) or once already on Standby. If the feature
   *  is turned off while Standby is showing, drop back to the Home Screen. */
  private _syncStandbyTimer(): void {
    const ms = this._config ? standbyReturnMs(this._config) : null;
    if (ms !== null && this._nav.length === 0 && !this._standby) {
      this._standbyTimer.start(ms);
      return;
    }
    this._standbyTimer.stop();
    if (ms === null && this._standby) this._standby = false;
  }

  override render(): TemplateResult | typeof nothing {
    if (!this._config || !this.hass) return nothing;
    // Top-level view choice (issue #65): Standby replaces the whole Home Screen (and
    // is only ever reached from the bare Home Screen, so no Overlay is live here). Any
    // interaction on it returns to Home and re-arms the idle countdown.
    if (this._standby) {
      return html`
        <div class="sizer">
          <div
            class="root"
            @pointerdown=${this._onStandbyActivity}
            @click=${this._onStandbyActivity}
            @mouseover=${this._onStandbyActivity}
          >
            <ecosee-standby-screen
              .view=${toStandbyView(this.hass, this._config)}
              .cornerStyle=${this._config.corner_style}
              .equipmentGlow=${this._config.equipment_glow}
            ></ecosee-standby-screen>
          </div>
        </div>
      `;
    }
    const view = toHomeView(this.hass, this._config);
    // The Home Screen is only mounted while there is no Overlay on top of it — not
    // just visually covered, genuinely absent from the DOM. An Overlay's opaque
    // canvas used to be the only thing hiding it, which meant a transparent
    // background_color bled the Home Screen through behind every menu/picker; with
    // nothing mounted underneath, the Overlay shell can honestly share the same
    // --ecosee-bg token (including "transparent") without anything to bleed
    // through. Mirrors how Standby already fully replaces the Home Screen above.
    return html`
      <div class="sizer">
        <div class="root">
          ${
            this._overlay
              ? nothing
              : html`
                  <ecosee-home-screen
                    .view=${view}
                    .cornerStyle=${this._config.corner_style}
                    .equipmentGlow=${this._config.equipment_glow}
                    .modeColor=${this._config.mode_color}
                    @ecosee-action=${this._onAction}
                    @pointerdown=${this._onHomeActivity}
                    @mouseover=${this._onHomeActivity}
                  ></ecosee-home-screen>
                `
          }
          ${this._renderOverlay(view)}
        </div>
      </div>
    `;
  }

  private _renderOverlay(view: HomeView): TemplateResult | typeof nothing {
    if (!this._overlay || !this._config || !this.hass) return nothing;
    const content = this._overlays[this._overlay].render(this.hass, this._config);
    if (content === nothing) return nothing;
    // One listening point for every Overlay. Editing Overlays emit the unified
    // `ecosee-service-call` and the hubs emit their navigation events — all bubbling
    // + composed, so they reach the shell here. The pointer/key listeners postpone
    // auto-revert (issue #13) on any interaction with the slotted content (even
    // inside a child Overlay's shadow DOM). `pointermove` matters too: the
    // Temperature scrubber captures the pointer on `pointerdown` and then scrubs via
    // `pointermove` alone, so a slow drag would otherwise let the timer expire.
    return html`
      <ecosee-overlay
        .tabs=${this._tabBar()}
        .equipment=${view.equipment}
        .cornerStyle=${this._config?.corner_style}
        .equipmentGlow=${this._config?.equipment_glow}
        @ecosee-overlay-dismiss=${this._closeOverlay}
        @ecosee-service-call=${this._onServiceCall}
        @ecosee-system-select=${this._onSystemSelect}
        @ecosee-tab-select=${this._onTabSelect}
        @ecosee-schedule-day-select=${this._onScheduleDaySelect}
        @ecosee-schedule-block-select=${this._onScheduleBlockSelect}
        @ecosee-schedule-time-confirm=${this._onScheduleTimeConfirm}
        @ecosee-schedule-block-remove=${this._onScheduleBlockRemove}
        @ecosee-schedule-add-block-open=${this._onScheduleAddBlockOpen}
        @ecosee-schedule-copy-open=${this._onScheduleCopyOpen}
        @ecosee-schedule-add-block-confirm=${this._onScheduleAddBlockConfirm}
        @ecosee-schedule-copy-confirm=${this._onScheduleCopyConfirm}
        @ecosee-comfort-setpoint-select=${this._onComfortSetpointSelect}
        @pointerdown=${this._onOverlayActivity}
        @pointermove=${this._onOverlayActivity}
        @keydown=${this._onOverlayActivity}
        >${content}</ecosee-overlay
      >
    `;
  }

  private _onAction = (event: CustomEvent<HomeActionDetail>): void => {
    switch (event.detail.action) {
      case 'temperature':
        // A tap on a setpoint oval carries which setpoint to foreground; a tap on
        // the current-temperature number carries none (the model keeps its default).
        this._tempSetpoint = event.detail.setpoint;
        this._open('temperature', 'home');
        break;
      case 'system-mode':
        this._open('system-mode', 'home');
        break;
      case 'fan':
        // Top-row shortcut into the Fan sub-screen (issue #45); opened from Home, so
        // dismissing returns Home. `_open`'s gate is `toFanModel().available` — broader
        // than the affordance's `hasFanSpeedControls` gate (issue #73) but a superset of
        // it, so a shown shortcut always opens; the On/Auto-only case never reaches here.
        this._open('fan', 'home');
        break;
      case 'menu':
        this._openMenu();
        break;
      case 'weather':
        this._open('weather', 'home');
        break;
      case 'resume-schedule':
        this._resumeSchedule();
        break;
    }
  };

  /** Tap on the Resume Schedule pill (config `resume_program`, ADR-0012): calls
   *  `ecobee.resume_program` directly — there is no Overlay involved, so this
   *  bypasses the Overlay-only `ecosee-service-call` path and calls `hass` straight
   *  from the Home Screen action, the same way `_openMenu` and the other Home
   *  Screen actions are handled inline here. Re-checks the config toggle rather than
   *  trusting the pill's own render gate, mirroring `_open`'s availability re-check
   *  for Overlays — a stray/stale `resume-schedule` action must not write against a
   *  config that never opted in. */
  private _resumeSchedule(): void {
    if (!this.hass || !this._config?.resume_program) return;
    const call = resumeProgramCall(this._config.entity);
    void this.hass.callService(call.domain, call.service, call.data);
  }

  /** Open an Overlay: gate on its availability, run its open side-effect, then place
   *  it on the nav stack. `'home'` replaces the bare Home Screen (so dismissing
   *  returns to Home); `'push'` stacks it on the current Overlay (so a sub-screen
   *  reached through the Main Menu returns to the menu). Hub-and-picker, CONTEXT.md. */
  private _open(kind: OverlayKind, mode: 'home' | 'push'): void {
    if (!this.hass || !this._config) return;
    const overlay = this._overlays[kind];
    if (!overlay.available(this.hass, this._config)) return; // nothing to show ⇒ no Overlay
    overlay.onOpen?.(this.hass, this._config);
    this._nav = mode === 'home' ? [kind] : [...this._nav, kind];
  }

  /** Fetch the Weather overlay's forecast via `weather.get_forecasts` (daily for
   *  page 2, hourly for the intra-day periods) and stash it for the seam. Each
   *  type is fetched independently so an entity that supports only some of them
   *  still gets what it can; failures degrade to an empty forecast. */
  private async _loadForecasts(): Promise<void> {
    const weatherEntity = this._config?.weather_entity;
    if (!this.hass || !weatherEntity) return;
    const [daily, hourly] = await Promise.all([
      this._getForecast(weatherEntity, 'daily'),
      this._getForecast(weatherEntity, 'hourly'),
    ]);
    // Guard a slow fetch resolving after the overlay was dismissed (or reopened).
    if (this._nav.includes('weather')) this._weatherForecasts = { daily, hourly };
  }

  private async _getForecast(entityId: string, type: ForecastType): Promise<ForecastEntry[]> {
    if (!this.hass) return [];
    try {
      const { domain, service, data } = getForecastsCall(entityId, type);
      const response = await this.hass.callService(domain, service, data, undefined, false, true);
      return parseForecastResponse(response, entityId);
    } catch {
      // The entity doesn't support this forecast type (or the call failed) — degrade.
      return [];
    }
  }

  /** The Date for `_scheduleDayIndex` within the *current* week (Sunday-first),
   *  computed fresh each render rather than stored — "today" and hence "this
   *  week" shift while the Card stays mounted, and this keeps that automatic
   *  rather than needing its own resync (ADR-0014: Stage 1 shows the current
   *  week only, no forward/back paging between weeks). */
  private _scheduleSelectedDate(): Date {
    const today = new Date();
    const weekStart = dayStart(new Date(today.getTime() - today.getDay() * 86400000));
    return new Date(weekStart.getTime() + this._scheduleDayIndex * 86400000);
  }

  /** Fetch the Schedule sub-screen's selected day via `calendar.get_events` and
   *  stash it for the seam (ADR-0014, mirroring `_loadForecasts`'s shape). */
  private async _loadSchedule(): Promise<void> {
    const entityId = this._config?.schedule_entity;
    if (!this.hass || !entityId) return;
    const day = this._scheduleSelectedDate();
    let events: RawScheduleEvent[] = [];
    try {
      const { domain, service, data } = getScheduleEventsCall(entityId, day);
      const response = await this.hass.callService(domain, service, data, undefined, false, true);
      events = parseScheduleResponse(response, entityId);
    } catch {
      // The entity doesn't support get_events (or the call failed) — degrade to
      // no blocks rather than throwing.
    }
    // Guard a slow fetch resolving after the overlay was dismissed, or the day
    // selection moved on again before this one landed.
    if (
      this._nav.includes('schedule') &&
      this._scheduleSelectedDate().getTime() === day.getTime()
    ) {
      this._scheduleEvents = events;
    }
  }

  /** Switch the Schedule sub-screen's selected day and re-fetch it. */
  private _onScheduleDaySelect = (event: CustomEvent<{ dayIndex: number }>): void => {
    this._scheduleDayIndex = event.detail.dayIndex;
    this._scheduleEvents = [];
    void this._loadSchedule();
  };

  /** Route a tap on an editable Schedule block to its Start Time picker
   *  (hub-and-picker, mirroring `_onSystemSelect`). */
  private _onScheduleBlockSelect = (event: CustomEvent<{ blockIndex: number }>): void => {
    this._scheduleEditingBlockIndex = event.detail.blockIndex;
    this._open('schedule-start-time', 'push');
  };

  /** Apply a Start Time picker confirmation: build the `calendar/event/update`
   *  websocket write (schedule.ts's `moveBlockStart` — growing the edited block's
   *  own footprint, or extending its predecessor's when shrinking; see
   *  schedule.ts's module doc), send it, re-fetch the day, and pop back to the
   *  Schedule sub-screen. A `null` write (a no-op move, or no in-day predecessor
   *  to shrink into) still returns to Schedule — there is nothing to apply, but
   *  the picker has served its purpose. */
  private _onScheduleTimeConfirm = (event: CustomEvent<{ minutes: number }>): void => {
    void this._applyScheduleWrite((entityId, blocks, index, day) =>
      moveBlockStart(entityId, blocks, index, day, event.detail.minutes),
    );
  };

  /** Apply a Start Time picker's "Remove from schedule": build the merge-into-
   *  predecessor write (schedule.ts's `removeBlock`), send it, re-fetch, and pop
   *  back to the Schedule sub-screen. */
  private _onScheduleBlockRemove = (): void => {
    void this._applyScheduleWrite((entityId, blocks, index, day) =>
      removeBlock(entityId, blocks, index, day),
    );
  };

  private async _applyScheduleWrite(
    build: (
      entityId: string,
      blocks: ReturnType<typeof toScheduleBlocks>,
      index: number,
      day: Date,
    ) => ScheduleUpdateMessage | null,
  ): Promise<void> {
    const entityId = this._config?.schedule_entity;
    const index = this._scheduleEditingBlockIndex;
    if (!this.hass || !this._config || !entityId || index === undefined) return;
    const day = this._scheduleSelectedDate();
    const blocks = toScheduleBlocks(this._scheduleEvents, day, this._config);
    const message = build(entityId, blocks, index, day);
    if (message) await this._sendScheduleUpdate(message);
    await this._loadSchedule();
    this._closeOverlay();
  }

  /** Open the "+" Add to Schedule picker (hub-and-picker, mirroring
   *  `_onScheduleBlockSelect`). */
  private _onScheduleAddBlockOpen = (): void => {
    this._open('schedule-add-block', 'push');
  };

  /** Open the "Copy schedule to another day" picker. */
  private _onScheduleCopyOpen = (): void => {
    this._open('schedule-copy', 'push');
  };

  /** Apply the Add to Schedule picker's confirmation: build the
   *  `calendar.create_event` call (schedule.ts's `addBlockCall` — an ordinary
   *  service, unlike the move/remove writes), send it, re-fetch the day, and
   *  pop back to the Schedule sub-screen. */
  private _onScheduleAddBlockConfirm = (
    event: CustomEvent<{ comfortSetting: string; startMinutes: number; endMinutes: number }>,
  ): void => {
    void this._runScheduleTask(async (entityId) => {
      const day = this._scheduleSelectedDate();
      const { comfortSetting, startMinutes, endMinutes } = event.detail;
      const call = addBlockCall(entityId, comfortSetting, day, startMinutes, endMinutes);
      if (call) await this.hass?.callService(call.domain, call.service, call.data);
    });
  };

  /** Apply the Copy picker's confirmation: paint the selected day's whole
   *  arrangement onto every checked target day (schedule.ts's `copyDayCalls`,
   *  one `calendar.create_event` per source block per target day — an
   *  ordinary service, like `addBlockCall`), then re-fetch and pop back to the
   *  Schedule sub-screen. */
  private _onScheduleCopyConfirm = (event: CustomEvent<{ targetDayIndices: number[] }>): void => {
    void this._runScheduleTask(async (entityId, blocks) => {
      const weekStart = dayStart(
        new Date(this._scheduleSelectedDate().getTime() - this._scheduleDayIndex * 86400000),
      );
      for (const targetIndex of event.detail.targetDayIndices) {
        const targetDay = new Date(weekStart.getTime() + targetIndex * 86400000);
        for (const call of copyDayCalls(entityId, blocks, targetDay)) {
          await this.hass?.callService(call.domain, call.service, call.data);
        }
      }
    });
  };

  /** Shared shape for the Add Block / Copy confirmations: resolve the schedule
   *  entity and the selected day's current blocks, run the write(s), re-fetch
   *  the selected day (a copy/add may have touched it), and pop back to the
   *  Schedule sub-screen. */
  private async _runScheduleTask(
    run: (entityId: string, blocks: ReturnType<typeof toScheduleBlocks>) => Promise<void>,
  ): Promise<void> {
    const entityId = this._config?.schedule_entity;
    if (!this.hass || !this._config || !entityId) return;
    const blocks = toScheduleBlocks(
      this._scheduleEvents,
      this._scheduleSelectedDate(),
      this._config,
    );
    await run(entityId, blocks);
    await this._loadSchedule();
    this._closeOverlay();
  }

  /** Send a `calendar/event/update` write — the only path Home Assistant exposes
   *  for it (schedule.ts's module doc: unlike `create_event`/`get_events`,
   *  `update_event` has no service equivalent, only this websocket command). */
  private async _sendScheduleUpdate(message: ScheduleUpdateMessage): Promise<void> {
    if (!this.hass?.connection) return;
    try {
      // ScheduleUpdateMessage is a plain JSON-shaped object; the cast is only for
      // the lack of an index signature, not a real shape mismatch.
      await this.hass.connection.sendMessagePromise(message as unknown as Record<string, unknown>);
    } catch {
      // Best-effort — a failed write leaves the schedule exactly as the
      // calendar entity last reported it; the next fetch reflects reality
      // either way, so there is nothing further to degrade to here.
    }
  }

  /** Route a Comfort Setpoints card pill to its Setpoint Adjust picker
   *  (hub-and-picker, mirroring `_onScheduleBlockSelect`). */
  private _onComfortSetpointSelect = (
    event: CustomEvent<{ preset: string; field: Setpoint }>,
  ): void => {
    this._setpointSelection = event.detail;
    this._open('setpoint-adjust', 'push');
  };

  /** Route a System sub-screen selector to its focused picker, pushed onto the stack
   *  so the picker's dismissal returns to the System sub-screen (hub-and-picker). The
   *  selector targets double as overlay kinds. */
  private _onSystemSelect = (event: CustomEvent<{ target: SystemSelectTarget }>): void => {
    this._open(event.detail.target, 'push');
  };

  /** Open the Main Menu: land directly on the first reachable section (System, then
   *  Sensors, then Fan, then Schedule, then Setpoints), where the bottom tab bar
   *  takes over navigation between the siblings — this replaces the old
   *  drill-down list. Weather is the last resort so a weather-only entity's gear
   *  still opens something (Weather carries no tab bar of its own, matching the
   *  device). `_open` re-checks availability, so an unreachable pick is a safe
   *  no-op. */
  private _openMenu(): void {
    if (!this.hass || !this._config) return;
    const hass = this.hass;
    const config = this._config;
    const order: OverlayKind[] = [
      'system',
      'sensors',
      'fan',
      'schedule',
      'setpoints',
      'filter',
      'weather',
    ];
    const first = order.find((kind) => this._overlays[kind].available(hass, config));
    if (first) this._open(first, 'home');
  }

  /** The bottom tab bar for the current screen, or `undefined` (⇒ no bar) unless a
   *  Main Menu section (System / Sensors / Fan / Schedule / Setpoints / Furnace
   *  Filter) is showing. Availability comes from the single overlay-descriptor
   *  table so the section predicates aren't duplicated. */
  private _tabBar(): TabBarModel | undefined {
    const kind = this._overlay;
    if (!this.hass || !this._config || !kind) return undefined;
    if (!(TAB_SECTIONS as readonly string[]).includes(kind)) return undefined;
    const hass = this.hass;
    const config = this._config;
    const model = toTabBarModel(kind, {
      system: this._overlays.system.available(hass, config),
      sensors: this._overlays.sensors.available(hass, config),
      fan: this._overlays.fan.available(hass, config),
      schedule: this._overlays.schedule.available(hass, config),
      setpoints: this._overlays.setpoints.available(hass, config),
      filter: this._overlays.filter.available(hass, config),
    });
    return model.available ? model : undefined;
  }

  /** Route a tab tap: every target is a section, so it replaces the current screen
   *  (`'home'` mode) so the sibling sections stay a flat switch — dismissing any of
   *  them returns Home, as on the device. The old thermostat-badge target (which
   *  called `_revertToHome()` directly) was removed in ADR-0017 — ✕ already does
   *  the same thing. */
  private _onTabSelect = (event: CustomEvent<{ target: TabTarget }>): void => {
    this._open(event.detail.target, 'home');
  };

  /** Dismiss (✕ / outside-tap): pop one level and drop per-open state so a later
   *  open starts fresh. From a top-level Overlay that is Home; from a menu-reached
   *  picker that is the menu. */
  private _closeOverlay = (): void => {
    this._nav = this._nav.slice(0, -1);
    // Drop per-open state so a later open starts fresh. The seeds are per-Overlay
    // and never co-present, so clearing all is equivalent to clearing just the one
    // dismissed — and is the same cleanup auto-revert reuses.
    this._clearOverlaySeeds();
  };

  /** Auto-revert (issue #13): collapse any open Overlay all the way back to the
   *  bare Home Screen and drop per-open state, exactly as a manual dismiss leaves
   *  it. Driven by the inactivity timer on expiry. */
  private _revertToHome(): void {
    if (this._nav.length === 0) return;
    this._nav = [];
    this._clearOverlaySeeds();
  }

  /** Clear per-open Overlay state so a later open starts fresh: the Temperature
   *  Adjust seed, the Weather forecast, which Schedule block the Start Time
   *  picker was editing, and which Comfort Setpoints field the Setpoint Adjust
   *  picker was editing. Deliberately does NOT clear `_scheduleDayIndex` /
   *  `_scheduleEvents` — the selected day and its last-fetched blocks are kept
   *  across a close so reopening Schedule shows them immediately rather than a
   *  blank "Loading…" flash while a fresh fetch lands. */
  private _clearOverlaySeeds(): void {
    this._tempSeed = undefined;
    this._tempSetpoint = undefined;
    this._weatherForecasts = undefined;
    this._scheduleEditingBlockIndex = undefined;
    this._setpointSelection = undefined;
  }

  /** Any interaction within an open Overlay (tap, drag start, key) postpones
   *  auto-revert — the device keeps a screen up while you are using it. */
  private _onOverlayActivity = (): void => {
    this._inactivity.reset();
  };

  /** Any interaction on the bare Home Screen (tap / click / mouseover) restarts the
   *  Home → Standby countdown (issue #65). A no-op while an Overlay is open, since
   *  the countdown is stopped then and {@link InactivityTimer.reset} does nothing
   *  while disabled. */
  private _onHomeActivity = (): void => {
    this._standbyTimer.reset();
  };

  /** Any interaction on the Standby Screen (tap / click / mouseover) returns to the
   *  Home Screen (issue #65); clearing `_standby` re-arms a fresh 60s countdown via
   *  {@link _syncStandbyTimer}. */
  private _onStandbyActivity = (): void => {
    this._standby = false;
  };

  /** The Home → Standby countdown expired: switch to the Standby Screen (issue #65).
   *  Guarded so a countdown that somehow outlived a nav change can't switch while an
   *  Overlay is open. */
  private _enterStandby(): void {
    if (this._nav.length > 0) return;
    this._standby = true;
  }

  /** Apply a service call emitted by an Overlay (temperature setpoint, System
   *  Mode, …). Every Overlay carries its change as a pure `ServiceCall`, so the
   *  host card just forwards it to Home Assistant. */
  private _onServiceCall = (event: CustomEvent<{ call: ServiceCall }>): void => {
    if (!this.hass) return;
    const { domain, service, data } = event.detail.call;
    void this.hass.callService(domain, service, data);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    [CARD_TYPE]: EcoseeCard;
  }
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
      preview?: boolean;
    }>;
  }
}

// Register with Home Assistant's card picker.
window.customCards = window.customCards ?? [];
window.customCards.push({
  type: CARD_TYPE,
  name: 'ecosee',
  description: 'A full-screen thermostat card for any climate entity.',
  preview: true,
});

console.info(
  `%c ecosee %c v${VERSION} `,
  'color:#0a0d10;background:#62cfe9;border-radius:3px 0 0 3px;padding:1px 4px',
  'color:#62cfe9;background:#0a0d10;border-radius:0 3px 3px 0;padding:1px 4px',
);
